"""Rebrand injector plugins (one concern per module)."""

from .base import Injector, PatchCounts
from .brand import BrandStringsInjector
from .features import (
    PaletteInjector,
    SettingsInjector,
    StashInjector,
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
    "BrandStringsInjector",
    "Injector",
    "LogoInjector",
    "PaletteInjector",
    "PatchCounts",
    "SettingsInjector",
    "StashInjector",
    "TabrenameInjector",
    "TextpickInjector",
    "ThemeInjector",
    "ToolbarDefaultsInjector",
    "WelcomeInjector",
    "WorkspacesInjector",
    "XhtmlInjector",
]
