"""
api/auth_routes.py — OIDC login, callback, token refresh, and /me endpoint.

When auth is disabled (local-only mode) the /me endpoint returns the
synthetic admin user and the OIDC routes return 501.
"""
from __future__ import annotations

import logging
import re
from urllib.parse import urlencode, urlsplit

from fastapi import APIRouter, Cookie, Depends, HTTPException, Query, Response, status
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse, RedirectResponse
from pydantic import BaseModel

from auth.dependencies import get_current_user
from auth.idp import IdPDeletionError, delete_idp_user
from auth.rbac import effective_permissions
from auth.oauth2 import EmailNotVerifiedError, fetch_oidc_config, verify_id_token
from config import get_settings
from db import audit as db_audit
from db import export as db_export
from db import users as db_users
from db.pool import DBConn, get_connection
from schemas.auth import AuthUser

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/auth", tags=["auth"])

# ---------------------------------------------------------------------------
# Token cookies (httpOnly). Tokens never reach JavaScript: an XSS can still
# *use* the session while the page is open, but cannot exfiltrate the refresh
# token for offline reuse — the main risk of the previous localStorage scheme.
# SameSite=Lax blocks cross-site POST/PATCH/DELETE from carrying the cookies
# (our state-changing routes are all non-GET), which is the CSRF story.
# ---------------------------------------------------------------------------

ACCESS_COOKIE = "cascade_access"
REFRESH_COOKIE = "cascade_refresh"
_REFRESH_MAX_AGE = 30 * 24 * 3600  # 30 days; Zitadel rotates it on each use


def _set_token_cookies(response: Response, tokens: dict) -> None:
    secure = get_settings().env == "production"
    response.set_cookie(
        ACCESS_COOKIE,
        tokens["access_token"] or "",
        max_age=int(tokens.get("expires_in") or 3600),
        httponly=True,
        secure=secure,
        samesite="lax",
        path="/api",
    )
    if tokens.get("refresh_token"):
        response.set_cookie(
            REFRESH_COOKIE,
            tokens["refresh_token"],
            max_age=_REFRESH_MAX_AGE,
            httponly=True,
            secure=secure,
            samesite="lax",
            # Narrow path: the refresh token is only ever needed by /refresh,
            # so no other request carries it.
            path="/api/auth/refresh",
        )


def _clear_token_cookies(response: Response) -> None:
    response.delete_cookie(ACCESS_COOKIE, path="/api")
    response.delete_cookie(REFRESH_COOKIE, path="/api/auth/refresh")


class MeResponse(BaseModel):
    sub: str
    email: str
    display_name: str
    roles: list[str]
    # Effective (wildcard-expanded) permissions — the client gates UI on this
    # list instead of mirroring auth/rbac.py's role→permission map.
    permissions: list[str]
    auth_enabled: bool


class AuthConfig(BaseModel):
    auth_enabled: bool
    # Whether to offer the "Continue with Google" shortcut. A boolean, never the
    # Zitadel IdP id itself — the client has no use for the id and it stays
    # server-side.
    google_login: bool = False


@router.get("/config", response_model=AuthConfig, summary="Public auth config")
async def auth_config() -> AuthConfig:
    """Whether the backend enforces auth, and which sign-in shortcuts to offer.

    Deliberately UNauthenticated so the frontend can learn this before a user
    has a token (otherwise a fresh/guest user could never discover that sign-in
    is required, nor find the login)."""
    settings = get_settings()
    return AuthConfig(
        auth_enabled=settings.auth_enabled,
        google_login=bool(settings.auth_enabled and settings.oidc_google_idp_id),
    )


@router.get("/me", response_model=MeResponse, summary="Current user")
async def me(user: AuthUser = Depends(get_current_user)) -> MeResponse:
    settings = get_settings()
    return MeResponse(
        sub=user.sub,
        email=user.email,
        display_name=user.display_name,
        roles=user.roles,
        permissions=sorted(effective_permissions(user.roles)),
        auth_enabled=settings.auth_enabled,
    )


@router.get("/me/export", summary="Download everything stored about me (GDPR access)")
async def export_me(
    user: AuthUser = Depends(get_current_user),
    conn: DBConn = Depends(get_connection),
) -> Response:
    """Right of access / portability (GDPR Art. 15 & 20) as a JSON download.

    Self-service and scoped to the caller: there is no user id parameter, so
    this endpoint cannot be pointed at somebody else's data. Served as an
    attachment rather than an inline body because the point is for the user to
    keep the file.
    """
    if not get_settings().auth_enabled:
        raise HTTPException(status_code=501, detail="No database in local-only mode.")

    db_user = await db_users.get_user_by_external_id(conn, user.sub)
    if db_user is None:
        raise HTTPException(status_code=404, detail="Account not found.")

    payload = await db_export.export_user_data(
        conn, user_id=db_user.id, external_id=db_user.external_id
    )
    # jsonable_encoder handles the datetimes/UUIDs/JSONB the tables return.
    return JSONResponse(
        content=jsonable_encoder(payload),
        headers={"Content-Disposition": 'attachment; filename="cascade-my-data.json"'},
    )


@router.delete(
    "/me",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete my own account (GDPR erasure)",
)
async def delete_me(
    user: AuthUser = Depends(get_current_user),
    conn: DBConn = Depends(get_connection),
) -> None:
    # Erase in the IdP first so the identity can't silently re-register. If that
    # fails, abort BEFORE touching the app DB so erasure stays all-or-nothing.
    try:
        await delete_idp_user(user.sub)
    except IdPDeletionError as exc:
        logger.warning("IdP deletion failed for %s: %s", user.sub, exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Identity provider deletion failed; account not deleted. Please retry.",
        ) from exc

    # App-record delete + audit atomically.
    async with conn.transaction():
        deleted = await db_users.delete_user_by_external_id(conn, user.sub)
        if deleted is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Account not found."
            )
        await db_audit.record(
            conn,
            action="account_delete",
            user_email=deleted.email,
            details={"external_id": deleted.external_id, "self": True},
        )


# OIDC `prompt` values we let the frontend request. `create` sends the user
# straight to Zitadel's registration form (the "Create account" button);
# `login` forces a fresh credential prompt even if an SSO session exists.
# Anything else is ignored rather than forwarded blindly to the IdP.
_ALLOWED_PROMPTS = {"create", "login", "select_account", "none"}

# A conservative BCP-47 shape for `ui_locales`: space-separated language tags
# (`it`, `en-US`), letters/digits/hyphens only. Zitadel renders its login UI in
# the first tag it supports; a malformed value would just be echoed into the
# redirect URL, so we validate before forwarding.
_UI_LOCALES_RE = re.compile(r"^[A-Za-z0-9-]+( [A-Za-z0-9-]+)*$")


@router.get("/login", summary="Redirect to OIDC provider login page")
async def login(
    state: str = Query("", max_length=256),
    code_challenge: str = Query(..., max_length=256),
    code_challenge_method: str = Query("S256", max_length=16),
    prompt: str = Query("", max_length=32),
    ui_locales: str = Query("", max_length=64),
    idp: str = Query("", max_length=32),
) -> RedirectResponse:
    """Redirect the browser to the IdP's authorize endpoint.

    `state` is an opaque anti-CSRF value generated by the frontend before the
    redirect and validated by the frontend callback page when the IdP returns
    it. The backend only forwards it (standard OAuth2 state round-trip).

    `code_challenge` is the PKCE (RFC 7636) challenge for this login attempt —
    this app is registered as a public client (no client_secret); PKCE proves
    the browser session that requests the token exchange is the one that
    started this authorize request, in place of a shared static secret.

    `prompt` (optional) is forwarded only when it is one of `_ALLOWED_PROMPTS` —
    the frontend sends `create` from its "Create account" button so the user
    lands on Zitadel's sign-up form instead of the sign-in form.

    `ui_locales` (optional) is the caller's preferred language (from the
    browser); Zitadel renders its hosted login/registration pages in it.

    `idp` (optional) is a symbolic provider name — only `google` is wired, and
    only when `OIDC_GOOGLE_IDP_ID` is configured. It maps server-side to
    Zitadel's `urn:zitadel:iam:org:idp:id:<id>` scope, which sends the user
    straight to Google's consent screen. The client never learns or supplies the
    id, so this cannot be used to steer a login at an arbitrary IdP.
    """
    settings = get_settings()
    if not settings.auth_enabled:
        raise HTTPException(status_code=501, detail="Auth is disabled in local-only mode.")
    if code_challenge_method != "S256":
        # "plain" would gut PKCE (verifier == challenge, visible in the
        # redirect URL). Our frontend only ever sends S256; anything else is
        # a downgrade attempt, not a legitimate client.
        raise HTTPException(status_code=422, detail="code_challenge_method must be S256.")

    oidc_cfg = await fetch_oidc_config()
    auth_endpoint = oidc_cfg.get("authorization_endpoint")
    if not auth_endpoint:
        raise HTTPException(status_code=503, detail="OIDC provider unavailable.")

    scopes = settings.oidc_scopes.replace(",", " ")
    if idp == "google" and settings.oidc_google_idp_id:
        # Zitadel's "jump straight to this IdP" mechanism is a scope, not a
        # parameter. Unknown/unconfigured values fall through to the normal
        # Zitadel login form rather than erroring — a missing shortcut must
        # never block sign-in.
        scopes = f"{scopes} urn:zitadel:iam:org:idp:id:{settings.oidc_google_idp_id}"
    params = {
        "response_type": "code",
        "client_id": settings.oidc_client_id or "",
        "redirect_uri": settings.oidc_redirect_uri,
        "scope": scopes,
        "code_challenge": code_challenge,
        "code_challenge_method": code_challenge_method,
    }
    if state:
        params["state"] = state
    if prompt in _ALLOWED_PROMPTS:
        params["prompt"] = prompt
    if ui_locales and _UI_LOCALES_RE.match(ui_locales):
        params["ui_locales"] = ui_locales
    return RedirectResponse(url=f"{auth_endpoint}?{urlencode(params)}")


async def _token_exchange(
    data: dict[str, str],
    failure_status: int,
    failure_detail: str,
    verify_email: bool = False,
) -> tuple[dict, dict | None]:
    """POST an OAuth grant to the OIDC token endpoint and normalise the tokens.

    Shared by /callback (authorization_code) and /refresh (refresh_token).
    Requires auth to be enabled; client_id is always added. client_secret is
    added only if configured — this app is registered as a public PKCE client
    (see /login), so normally no secret exists and the authorization_code
    grant instead carries a `code_verifier` (added by the /callback caller).

    When `verify_email` is set (login only), the returned id token is validated
    and its email must be verified — the one point in the flow where the id
    token, which carries `email_verified`, is available.

    Returns (token payload for the client, id-token claims or None). The claims
    are only produced on the verify_email path; /callback uses them to persist
    email/name — the access token carries no profile claims, so login is the
    single moment the backend can learn them.
    """
    settings = get_settings()
    if not settings.auth_enabled:
        raise HTTPException(status_code=501, detail="Auth is disabled in local-only mode.")

    oidc_cfg = await fetch_oidc_config()
    token_endpoint = oidc_cfg.get("token_endpoint")
    if not token_endpoint:
        raise HTTPException(status_code=503, detail="OIDC provider unavailable.")

    request_data = {**data, "client_id": settings.oidc_client_id}
    if settings.oidc_client_secret:
        request_data["client_secret"] = settings.oidc_client_secret

    import httpx
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            token_endpoint,
            data=request_data,
            timeout=15,
        )
        if resp.status_code != 200:
            raise HTTPException(status_code=failure_status, detail=failure_detail)
        tokens = resp.json()

    id_claims: dict | None = None
    if verify_email:
        id_token = tokens.get("id_token")
        if not id_token:
            raise HTTPException(status_code=403, detail="No id token returned; cannot verify email.")
        try:
            id_claims = await verify_id_token(id_token)
        except EmailNotVerifiedError:
            # The one failure the user can act on. Sent as a structured detail so
            # the frontend can branch on a stable `code` instead of pattern-
            # matching prose (which also matched the generic message below).
            raise HTTPException(
                status_code=403,
                detail={
                    "code": "email_not_verified",
                    "message": "Email address is not verified.",
                },
            )
        except Exception:
            # Everything else — bad signature, expired, and the ValueErrors that
            # name server configuration ("No audience configured…") — collapses
            # to one opaque message. An unauthenticated caller learns nothing
            # about how this deployment is wired.
            logger.warning("id token verification failed at login.", exc_info=True)
            raise HTTPException(
                status_code=403,
                detail={
                    "code": "verification_failed",
                    "message": "Could not verify your sign-in. Please try again.",
                },
            )

    return {
        "access_token": tokens.get("access_token"),
        "refresh_token": tokens.get("refresh_token"),
        "expires_in": tokens.get("expires_in"),
        "token_type": tokens.get("token_type", "Bearer"),
    }, id_claims


@router.get("/callback", summary="OIDC authorization code callback")
async def callback(
    response: Response,
    code: str = Query(...),
    code_verifier: str = Query(...),
    conn: DBConn = Depends(get_connection),
) -> dict:
    payload, id_claims = await _token_exchange(
        {
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": get_settings().oidc_redirect_uri,
            "code_verifier": code_verifier,
        },
        failure_status=400,
        failure_detail="Token exchange failed.",
        verify_email=True,
    )
    # Persist email/name NOW: the id token is the only token carrying profile
    # claims (access tokens omit them), so login is the single moment the app
    # DB can learn who this sub is. Without this, users exist as sub-only rows
    # and admin tooling that looks up by email (create_admin.py) can't find
    # them. Best-effort: a failed write must not fail the login.
    if id_claims is not None and id_claims.get("sub"):
        try:
            await db_users.upsert_user(
                conn,
                external_id=str(id_claims["sub"]),
                email=id_claims.get("email") or None,
                name=id_claims.get("name") or id_claims.get("preferred_username") or None,
            )
        except Exception:  # noqa: BLE001 — profile capture is best-effort
            logger.warning("Could not persist profile claims at login.", exc_info=True)

    # Tokens travel as httpOnly cookies only — never in the body, so page
    # JavaScript (and any XSS running as it) can never read them.
    _set_token_cookies(response, payload)
    return {"ok": True}


@router.post("/refresh", summary="Rotate the session cookies via the refresh token")
async def refresh(
    response: Response,
    refresh_cookie: str | None = Cookie(None, alias=REFRESH_COOKIE),
) -> dict:
    # 401 on failure => the refresh token is invalid/expired; client must re-login.
    if not refresh_cookie:
        raise HTTPException(status_code=401, detail="No refresh session.")
    payload, _ = await _token_exchange(
        {"grant_type": "refresh_token", "refresh_token": refresh_cookie},
        failure_status=401,
        failure_detail="Token refresh failed.",
    )
    _set_token_cookies(response, payload)
    return {"ok": True}


@router.post("/logout", summary="End the session (cookies + IdP SSO session)")
async def logout(response: Response) -> dict:
    """Clear the token cookies and hand back the IdP's end_session URL.

    Clearing cookies alone is NOT a logout: the Zitadel SSO session survives,
    so the next 'sign in' silently re-authenticates the same account — on a
    shared computer that user cannot actually leave. The frontend must follow
    `logout_url` (RP-initiated logout, OIDC session management) so the IdP
    session dies too; Zitadel then redirects back to `post_logout_redirect_uri`
    (registered on the app as https://app.<domain>/).
    """
    _clear_token_cookies(response)

    settings = get_settings()
    if not settings.auth_enabled:
        return {"logout_url": None}

    oidc_cfg = await fetch_oidc_config()
    end_session = oidc_cfg.get("end_session_endpoint")
    if not end_session:
        return {"logout_url": None}

    # The app's public origin, derived from the registered redirect URI
    # (https://app.<domain>/auth/callback -> https://app.<domain>/).
    parts = urlsplit(settings.oidc_redirect_uri)
    post_logout = f"{parts.scheme}://{parts.netloc}/"
    params = urlencode(
        {"post_logout_redirect_uri": post_logout, "client_id": settings.oidc_client_id}
    )
    return {"logout_url": f"{end_session}?{params}"}
