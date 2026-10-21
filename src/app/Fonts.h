#pragma once

#include <QString>

namespace resonance::fonts {

/// makes "Material Symbols Rounded" available. end4 installs it system-wide, so
/// that copy wins; otherwise the one installed beside resonance (or left in the
/// build tree) is loaded.
void loadIconFont();
/// "Material Symbols Rounded"
QString iconFamily();

/// makes google sans flex available, from the system or beside resonance:
/// the interface's face, and its titles drawn round through its variable
/// axes (TitleText). before interfaceFamily() is first asked.
void loadInterfaceFont();

/// the first installed face of end4's google sans flex, google sans, rubik,
/// inter and noto sans, or the platform default.
QString interfaceFamily();
/// the platform's own fixed-width face: a generic name like "monospace"
/// means nothing to macos, which then searches every family for it
QString fixedFamily();

} // namespace resonance::fonts
