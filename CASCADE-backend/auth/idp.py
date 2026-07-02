"""
auth/idp.py — identity-provider (Zitadel) side effects for account lifecycle.

The IdP owns the actual identity PII (email, name, credentials). Deleting an
account in our DB is not full erasure and, worse, leaves the IdP identity able to
silently re-register on next login. This module deletes the user in Zitadel too.
"""
from __future__ import annotations

import logging

import httpx

from config import get_settings

logger = logging.getLogger(__name__)


class IdPDeletionError(RuntimeError):
    """The IdP user deletion could not be completed (network error, auth failure,
    5xx). Callers should abort the erasure rather than delete the app record and
    leave the IdP identity able to re-register."""


async def delete_idp_user(external_id: str) -> bool:
    """Delete the user in Zitadel (id == the OIDC `sub` == our external_id).

    Returns True if deleted (or already absent). When Zitadel management is not
    configured this is a no-op that logs a prominent warning and returns False —
    the caller still removes the app record, but the operator must delete the
    Zitadel user manually to complete GDPR erasure and prevent re-registration.
    """
    settings = get_settings()
    base = settings.zitadel_mgmt_url
    token = settings.zitadel_mgmt_token
    if not (base and token):
        logger.warning(
            "Zitadel management not configured: app account for %s deleted, but the "
            "IdP identity was NOT removed. Delete it manually to complete erasure.",
            external_id,
        )
        return False

    url = f"{base.rstrip('/')}/management/v1/users/{external_id}"
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.delete(
                url, headers={"Authorization": f"Bearer {token}"}, timeout=10
            )
        # 404 == already gone; treat as success for idempotent erasure.
        if resp.status_code not in (200, 404):
            resp.raise_for_status()
    except httpx.HTTPError as exc:
        # Bad/expired token, 5xx, timeout, connection error — surface a typed
        # error so the caller aborts instead of returning an opaque 500.
        raise IdPDeletionError(
            f"Zitadel deletion failed for {external_id}: {exc}"
        ) from exc
    logger.info("Deleted Zitadel user %s (status %s).", external_id, resp.status_code)
    return True
