"""Rebrand injector plugins (one concern per module)."""

from .base import Injector, PatchCounts
from .brand import BrandStringsInjector
from .features import (
    ArchiveInjector,
    PaletteInjector,
    SettingsInjector,
    TabrenameInjector,
    TextpickInjector,
    ThemeInjector,
    WelcomeInjector,
    WorkspacesInjector,
)
from .logos import LogoInjector
from .toolbar import ToolbarDefaultsInjector
from .xhtml import CANONICAL_TAG_ORDER, XhtmlInjector

__all__ = [
    "CANONICAL_TAG_ORDER",
    "ArchiveInjector",
    "BrandStringsInjector",
    "Injector",
    "LogoInjector",
    "PaletteInjector",
    "PatchCounts",
    "SettingsInjector",
    "TabrenameInjector",
    "TextpickInjector",
    "ThemeInjector",
    "ToolbarDefaultsInjector",
    "WelcomeInjector",
    "WorkspacesInjector",
    "XhtmlInjector",
]
