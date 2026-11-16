"""Rebrand injector plugins (one concern per module)."""

from .base import Injector, PatchCounts
from .brand import BrandStringsInjector
from .features import (
    PaletteInjector,
    SettingsInjector,
    TabrenameInjector,
    ThemeInjector,
    WorkspacesInjector,
)
from .logos import LogoInjector
from .toolbar import ToolbarDefaultsInjector
from .xhtml import CANONICAL_TAG_ORDER, XhtmlInjector

__all__ = [
    "CANONICAL_TAG_ORDER",
    "BrandStringsInjector",
    "Injector",
    "LogoInjector",
    "PaletteInjector",
    "PatchCounts",
    "SettingsInjector",
    "TabrenameInjector",
    "ThemeInjector",
    "ToolbarDefaultsInjector",
    "WorkspacesInjector",
    "XhtmlInjector",
]
