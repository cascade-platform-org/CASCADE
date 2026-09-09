"""Tests for db/export.py — the GDPR Art. 15/20 data export.

These run against a real database (TEST_DATABASE_URL) because the two things
most likely to break are both database behaviours: asyncpg handing JSONB back
as a string, and the queries that decide which rows belong to a subject.
"""
from __future__ import annotations

import json

from db import audit as db_audit
from db import export as db_export
from db import projects as db_projects
from db import users as db_users


def _bundle():
    """The smallest valid bundle, built the way test_sync_routes does (the
    models are imported inside the function because Project resolves a forward
    reference to PropagationResult only once the schemas package is loaded)."""
    from schemas.config import (
        CategoryDefinition,
        ConfigMeta,
        FunctionalityScaleLevel,
        ModelConfiguration,
    )
    from schemas.network import Canvas, Graph, Project, ProjectMeta
    from schemas.results import PropagationResult
    from schemas.sync import ProjectBundle

    # Project references PropagationResult only under TYPE_CHECKING, so the
    # forward reference stays unresolved until something imports results. The
    # API tests get this for free by importing main; here it is explicit.
    Project.model_rebuild(_types_namespace={"PropagationResult": PropagationResult})

    config = ModelConfiguration(
        version="1.0",
        meta=ConfigMeta(name="t"),
        functionality_scale=[
            FunctionalityScaleLevel(level=lvl, label=str(lvl), color="#000")
            for lvl in range(1, 5)
        ],
        categories=[CategoryDefinition(name="water", category_type="Requisite")],
    )
    project = Project(
        version="2.0",
        meta=ProjectMeta(name="p"),
        nodes={},
        edges={},
        canvases=[Canvas(id="c1", graph=Graph(graph_type="generic", node_ids=[], edge_ids=[]))],
    )
    return ProjectBundle(project=project, config=config)


async def test_export_decodes_jsonb_instead_of_returning_strings(migrated_db):
    """asyncpg returns JSONB as text unless a codec is registered (db/projects.py
    json.loads for the same reason). An export of escaped JSON strings would not
    be the machine-readable form Art. 20 asks for."""
    async with migrated_db.acquire() as conn:
        user = await db_users.upsert_user(
            conn, external_id="sub-export-1", email="e1@example.com", name="Eve"
        )
        await db_projects.save_version(
            conn, owner_id=user.id, name="Net", description=None, data=_bundle()
        )
        await db_audit.record(
            conn,
            action="role_change",
            user_id=user.id,
            user_email=user.email,
            details={"old_role": "viewer", "new_role": "analyst"},
        )
        data = await db_export.export_user_data(
            conn, user_id=user.id, external_id=user.external_id
        )

    project = data["synced_projects"][0]
    assert isinstance(project["data"], dict), "JSONB must decode to an object"
    assert "project" in project["data"]

    entry = data["audit_entries"][0]
    assert isinstance(entry["details"], dict)
    assert entry["details"]["new_role"] == "analyst"

    # And the whole document must survive a JSON round-trip (it is served as a file).
    assert json.loads(json.dumps(data, default=str))


async def test_export_is_scoped_to_one_subject(migrated_db):
    """Another user's synced projects must never appear in this user's export."""
    async with migrated_db.acquire() as conn:
        mine = await db_users.upsert_user(
            conn, external_id="sub-mine", email="mine@example.com", name="Mine"
        )
        theirs = await db_users.upsert_user(
            conn, external_id="sub-theirs", email="theirs@example.com", name="Theirs"
        )
        await db_projects.save_version(
            conn, owner_id=theirs.id, name="Secret", description=None, data=_bundle()
        )
        data = await db_export.export_user_data(
            conn, user_id=mine.id, external_id=mine.external_id
        )

    assert data["synced_projects"] == []
    assert data["account"]["email"] == "mine@example.com"


async def test_export_includes_actions_taken_on_me_without_naming_the_admin(migrated_db):
    """A role change an admin made TO this user is the subject's data (Art. 15),
    but the row also identifies the admin — Art. 15(4) says access must not
    adversely affect others' rights, so the actor is not disclosed."""
    async with migrated_db.acquire() as conn:
        admin = await db_users.upsert_user(
            conn, external_id="sub-admin", email="admin@example.com", name="Admin"
        )
        subject = await db_users.upsert_user(
            conn, external_id="sub-subject", email="subject@example.com", name="Subject"
        )
        await db_audit.record(
            conn,
            action="role_change",
            user_id=admin.id,
            user_email=admin.email,
            details={"target_user_id": subject.id, "old_role": "analyst", "new_role": "manager"},
        )
        data = await db_export.export_user_data(
            conn, user_id=subject.id, external_id=subject.external_id
        )

    about = data["audit_entries_about_me"]
    assert len(about) == 1, "the subject must see that their role was changed"
    assert about[0]["details"]["new_role"] == "manager"
    # The acting admin is nowhere in the document.
    assert "admin@example.com" not in json.dumps(data, default=str)


async def test_export_covers_every_user_scoped_table(migrated_db):
    """Guard against the drift db/export.py warns about: a new table carrying a
    `user_id` that nobody adds to the export. Fails loudly when the schema grows
    so the omission is caught here rather than in a rights request."""
    async with migrated_db.acquire() as conn:
        tables = {
            r["table_name"]
            for r in await conn.fetch(
                """
                SELECT table_name FROM information_schema.columns
                WHERE table_schema = 'public' AND column_name IN ('user_id', 'owner_id')
                """
            )
        }
    # users itself is the subject; the rest must each have a section in the export.
    covered = {"projects", "audit_logs", "analysis_logs", "activity_log_uploads"}
    assert tables == covered, (
        f"tables keyed to a person changed: {tables ^ covered}. "
        "Add it to db/export.py, scripts/purge_expired.py (if a log), and the "
        "Art. 30 table in docs/project/privacy-and-data-protection.md."
    )
