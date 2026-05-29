"""auth/models.py — DB-level user and role models (not Pydantic schemas)."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional


@dataclass
class DBUser:
    id: str
    external_id: str
    email: str
    name: Optional[str]
    role_name: str


@dataclass
class DBRole:
    name: str
    description: Optional[str]
    permissions: list[str]
