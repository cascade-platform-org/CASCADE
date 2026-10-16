"""auth/oauth2.py verifying real signed tokens against a JWKS (PyJWT)."""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
from typing import Any

import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

import config
from auth import oauth2

ISSUER = "https://id.example"
CLIENT = "cascade-app"


def _key(kid: str) -> tuple[Any, dict[str, Any]]:
    private = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    public_jwk = json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(private.public_key()))
    return private, {**public_jwk, "kid": kid, "use": "sig", "alg": "RS256"}


KEY_A, JWK_A = _key("a")
KEY_B, JWK_B = _key("b")


def _token(private: Any, kid: str | None = "a", **claims: Any) -> str:
    now = int(time.time())
    body = {"iss": ISSUER, "aud": CLIENT, "sub": "user-1", "iat": now, "exp": now + 300, **claims}
    headers = {"kid": kid} if kid else {}
    return jwt.encode(body, private, algorithm="RS256", headers=headers)


@pytest.fixture
def idp(monkeypatch: pytest.MonkeyPatch) -> dict[str, Any]:
    """An IdP whose JWKS holds key `a`; `state["jwks"]` changes what the next fetch returns.
    The settings are pinned, so a developer's .env (JWT_AUDIENCE, say) does not leak in."""
    state: dict[str, Any] = {"jwks": {"keys": [JWK_A]}, "fetches": 0}

    async def fetch_jwks(force: bool = False) -> dict[str, Any]:
        state["fetches"] += 1
        return state["jwks"]

    async def fetch_oidc_config() -> dict[str, Any]:
        return {"issuer": ISSUER}

    settings = config.get_settings().model_copy(
        update={"oidc_discovery_url": f"{ISSUER}/.well-known/openid-configuration", "oidc_client_id": CLIENT, "jwt_audience": None, "jwt_algorithm": "RS256"}
    )
    monkeypatch.setattr(oauth2, "fetch_jwks", fetch_jwks)
    monkeypatch.setattr(oauth2, "fetch_oidc_config", fetch_oidc_config)
    monkeypatch.setattr(oauth2, "get_settings", lambda: settings)
    return state


async def test_a_valid_token_returns_its_claims(idp: dict[str, Any]) -> None:
    claims = await oauth2.verify_token(_token(KEY_A))
    assert claims["sub"] == "user-1"


async def test_a_token_without_kid_is_tried_against_every_key(idp: dict[str, Any]) -> None:
    idp["jwks"] = {"keys": [JWK_B, JWK_A]}
    assert (await oauth2.verify_token(_token(KEY_A, kid=None)))["sub"] == "user-1"


@pytest.mark.parametrize(
    "claims",
    [{"aud": "another-client"}, {"iss": "https://evil.example"}, {"exp": int(time.time()) - 10}],
    ids=["audience", "issuer", "expired"],
)
async def test_a_wrong_audience_issuer_or_expiry_is_refused(idp: dict[str, Any], claims: dict[str, Any]) -> None:
    with pytest.raises(jwt.PyJWTError):
        await oauth2.verify_token(_token(KEY_A, **claims))


async def test_a_token_signed_by_another_key_is_refused(idp: dict[str, Any]) -> None:
    with pytest.raises(jwt.PyJWTError):
        await oauth2.verify_token(_token(KEY_B, kid="a"))


async def test_hs256_signed_with_the_public_key_is_refused(idp: dict[str, Any]) -> None:
    """Algorithm confusion (CVE-2026-85394 in python-jose): the public key as an HMAC secret."""
    pem = KEY_A.public_key().public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo)
    der = KEY_A.public_key().public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)

    def b64(data: bytes) -> str:
        return base64.urlsafe_b64encode(data).rstrip(b"=").decode()

    now = int(time.time())
    header = b64(json.dumps({"alg": "HS256", "typ": "JWT", "kid": "a"}).encode())
    body = b64(json.dumps({"iss": ISSUER, "aud": CLIENT, "sub": "attacker", "exp": now + 300}).encode())
    for secret in (pem, der):
        signature = b64(hmac.new(secret, f"{header}.{body}".encode(), hashlib.sha256).digest())
        with pytest.raises(jwt.PyJWTError):
            await oauth2.verify_token(f"{header}.{body}.{signature}")


async def test_an_unknown_kid_refetches_the_jwks_once(idp: dict[str, Any], monkeypatch: pytest.MonkeyPatch) -> None:
    """The IdP rotated its keys: the first fetch lacks `b`, the refetch has it."""
    rotated = {"keys": [JWK_A, JWK_B]}
    calls: list[bool] = []

    async def fetch_jwks(force: bool = False) -> dict[str, Any]:
        calls.append(force)
        return rotated if force else {"keys": [JWK_A]}

    monkeypatch.setattr(oauth2, "fetch_jwks", fetch_jwks)
    assert (await oauth2.verify_token(_token(KEY_B, kid="b")))["sub"] == "user-1"
    assert calls == [False, True]
