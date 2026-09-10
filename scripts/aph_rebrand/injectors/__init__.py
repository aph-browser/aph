"""Rebrand injector plugins (one concern per module)."""

from .base import Injector, PatchCounts
from .brand import BrandStringsInjector
from .features import (
    ArchiveInjector,
    PaletteInjector,
    TabrenameInjector,
    TextpickInjector,
    ThemeInjector,
    WorkspacesInjector,
)
from .logos import LogoInjector
from .xhtml import CANONICAL_TAG_ORDER, XhtmlInjector

__all__ = [
    "CANONICAL_TAG_ORDER",
    "ArchiveInjector",
    "BrandStringsInjector",
    "Injector",
    "LogoInjector",
    "PaletteInjector",
    "PatchCounts",
    "TabrenameInjector",
    "TextpickInjector",
    "ThemeInjector",
    "WorkspacesInjector",
    "XhtmlInjector",
]
