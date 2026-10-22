cmake_minimum_required(VERSION 3.24)

project(Resonance
    VERSION 0.2.6
    DESCRIPTION "A native Spotify client"
    LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

# the window's title bar on macos is styled through appkit
if(APPLE)
    enable_language(OBJCXX)
    set(CMAKE_OBJCXX_STANDARD 20)
    set(CMAKE_OBJCXX_STANDARD_REQUIRED ON)
endif()

# on windows <cmath> gives M_PI only when asked, and windows.h's min and
# max macros are kept off std::min and std::max; msvc also reads the
# sources as utf-8
if(WIN32)
    add_compile_definitions(_USE_MATH_DEFINES NOMINMAX)
endif()
if(MSVC)
    add_compile_options(/utf-8)
    # material-color-utilities is vendored as it ships upstream, and it builds a
    # constant with the gnu compound-literal syntax, (Type){...}. msvc accepts
    # it under /permissive-, which cmake leaves off by default, and reports
    # C4576 without it. The warning is silenced rather than the vendored source
    # rewritten: every other compiler here takes the syntax already, so this
    # keeps the windows build agreeing with them instead of carrying a local
    # patch to a third party.
    add_compile_options(/wd4576)
endif()

include(GNUInstallDirs)
include(CTest)

if(CMAKE_SYSTEM_NAME STREQUAL "Linux")
    set(RESONANCE_IS_LINUX ON)
else()
    set(RESONANCE_IS_LINUX OFF)
endif()

# clang, not gcc, on linux: gcc's coroutine support is still experimental and
# miscompiles this codebase's QCoro tasks. A gcc build compiles and links, then
# dies with a segfault the first time a coroutine resumes (seen on gcc 16:
# a temporary QString in SoundCloud::applyStatus comes out uninitialised).
# Failing here is clearer than a crash at startup. macos and windows use their
# platform compilers and are not affected.
if(RESONANCE_IS_LINUX AND CMAKE_CXX_COMPILER_ID STREQUAL "GNU")
    message(FATAL_ERROR
        "Build Resonance on Linux with Clang, not GCC: GCC miscompiles the "
        "coroutines this app is built on, and the resulting binary crashes at "
        "startup. Configure again with "
        "-DCMAKE_C_COMPILER=clang -DCMAKE_CXX_COMPILER=clang++.")
endif()

# the wayland, d-bus and pipewire pieces. off elsewhere so the portable parts
# can be built and tested on a development machine without them.
option(RESONANCE_DESKTOP_INTEGRATION "Build the Linux desktop integration" ${RESONANCE_IS_LINUX})

find_package(Qt6 6.9 REQUIRED COMPONENTS
    Core Gui Network Concurrent Qml Quick QuickControls2 ShaderTools Multimedia
    WebEngineCore WebEngineQuick)
if(BUILD_TESTING)
    find_package(Qt6 6.9 REQUIRED COMPONENTS Test QuickTest)
endif()
if(RESONANCE_IS_LINUX)
    find_package(Qt6 6.9 REQUIRED COMPONENTS DBus Widgets)
else()
    find_package(Qt6 6.9 OPTIONAL_COMPONENTS DBus)
endif()
if(RESONANCE_DESKTOP_INTEGRATION)
    find_package(PkgConfig REQUIRED)
    pkg_check_modules(PULSE REQUIRED IMPORTED_TARGET libpulse)
endif()
find_package(Qt6Keychain REQUIRED)
if(WIN32)
    find_package(Qt6 6.9 REQUIRED COMPONENTS Widgets)
endif()
find_package(QCoro6 0.10 REQUIRED COMPONENTS Core Network)
qcoro_enable_coroutines()

qt_standard_project_setup(REQUIRES 6.9)
# modules get their own folder so tooling finds them as <dir>/Resonance/qmldir,
# clear of the executable (the same name on a case-insensitive disk).
set(QT_QML_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR}/qml_modules)

# --- spotify-core (Rust) -----------------------------------------------------

# the core sits inside this folder in resonance-linux, and beside it in the
# resonance repository with the apple apps
if(EXISTS ${CMAKE_CURRENT_SOURCE_DIR}/spotify-core/Cargo.toml)
    set(RESONANCE_CORE_DEFAULT ${CMAKE_CURRENT_SOURCE_DIR}/spotify-core)
else()
    set(RESONANCE_CORE_DEFAULT ${CMAKE_CURRENT_SOURCE_DIR}/../spotify-core)
endif()
set(RESONANCE_CORE_DIR ${RESONANCE_CORE_DEFAULT} CACHE PATH "The Rust core, spotify-core")

include(FetchContent)
FetchContent_Declare(Corrosion
    GIT_REPOSITORY https://github.com/corrosion-rs/corrosion.git
    GIT_TAG v0.6.1)
FetchContent_MakeAvailable(Corrosion)

corrosion_import_crate(
    MANIFEST_PATH ${RESONANCE_CORE_DIR}/Cargo.toml
    CRATE_TYPES staticlib
    NO_DEFAULT_FEATURES
    FEATURES capi)
target_include_directories(spotify_core INTERFACE
    ${RESONANCE_CORE_DIR}/include)
# what rustc reports as the staticlib's native dependencies
# (cargo rustc -- --print native-static-libs).
if(APPLE)
    target_link_libraries(spotify_core INTERFACE
        "-framework AudioToolbox" "-framework CoreAudio" "-framework IOKit"
        "-framework CoreFoundation" "-framework Foundation" "-framework SystemConfiguration"
        "-framework Security" objc iconv)
elseif(WIN32)
    # windows: wasapi for audio, schannel for tls, and what rust's std
    # needs; the linker leaves out any of them nothing uses
    target_link_libraries(spotify_core INTERFACE
        ws2_32 userenv bcrypt ntdll advapi32 kernel32 user32 shell32 ole32 oleaut32
        propsys crypt32 secur32 ncrypt runtimeobject synchronization)
else()
    find_package(ALSA REQUIRED)
    find_package(OpenSSL REQUIRED)
    find_package(Threads REQUIRED)
    target_link_libraries(spotify_core INTERFACE
        ALSA::ALSA OpenSSL::SSL OpenSSL::Crypto Threads::Threads ${CMAKE_DL_LIBS} m)
endif()

# --- material-color-utilities ------------------------------------------------

file(GLOB_RECURSE MCU_SOURCES CONFIGURE_DEPENDS
    ${CMAKE_CURRENT_SOURCE_DIR}/third_party/material-color-utilities/cpp/*.cc)
add_library(material_color_utilities STATIC ${MCU_SOURCES})
target_include_directories(material_color_utilities PUBLIC
    ${CMAKE_CURRENT_SOURCE_DIR}/third_party/material-color-utilities)
set_target_properties(material_color_utilities PROPERTIES POSITION_INDEPENDENT_CODE ON)

# --- fonts ---------------------------------------------------------------------

option(RESONANCE_DOWNLOAD_ICON_FONT
    "Download Material Symbols Rounded to install beside the app" ON)
include(cmake/DownloadAsset.cmake)
set(RESONANCE_FONT_DIRECTORY ${CMAKE_CURRENT_BINARY_DIR}/fonts)
if(RESONANCE_DOWNLOAD_ICON_FONT)
    set(RESONANCE_ICON_FONT ${RESONANCE_FONT_DIRECTORY}/MaterialSymbolsRounded.ttf)
    resonance_download_asset(
        "https://raw.githubusercontent.com/google/material-design-icons/737e3324305806514d7909874fa1818ae1808232/variablefont/MaterialSymbolsRounded%5BFILL,GRAD,opsz,wght%5D.ttf"
        "${RESONANCE_ICON_FONT}"
        95b24392bb49efd1bc3e92cff4e2452ad094461bab7c97e7d8723fab97e330ca)
    if(NOT APPLE)
        install(FILES ${RESONANCE_ICON_FONT} DESTINATION ${CMAKE_INSTALL_DATADIR}/resonance/fonts)
    endif()
    # the font's list of names, from the same commit: the tests check every
    # symbol the qml asks for is in it, since a misspelt one shows as text
    set(RESONANCE_ICON_CODEPOINTS ${RESONANCE_FONT_DIRECTORY}/MaterialSymbolsRounded.codepoints)
    if(BUILD_TESTING)
        resonance_download_asset(
            "https://raw.githubusercontent.com/google/material-design-icons/737e3324305806514d7909874fa1818ae1808232/variablefont/MaterialSymbolsRounded%5BFILL,GRAD,opsz,wght%5D.codepoints"
            "${RESONANCE_ICON_CODEPOINTS}"
            225bd09137103cb7746bc93dc08d08764c9f0c3bd04f4b958d4a3c3c19432dd6)
    endif()
endif()

# google sans flex, end4's face: the interface text, and the titles in it
# drawn round, wide and heavy through its variable axes. its licence travels
# with it.
option(RESONANCE_DOWNLOAD_INTERFACE_FONT
    "Download Google Sans Flex to install beside the app" ON)
if(RESONANCE_DOWNLOAD_INTERFACE_FONT)
    set(RESONANCE_INTERFACE_FONT ${RESONANCE_FONT_DIRECTORY}/GoogleSansFlex.ttf)
    set(RESONANCE_INTERFACE_FONT_LICENSE ${RESONANCE_FONT_DIRECTORY}/GoogleSansFlex-OFL.txt)
    set(RESONANCE_GOOGLE_FONTS https://raw.githubusercontent.com/google/fonts/a0e3dbcdc3a3ecfafff3f071159ae0221628922d/ofl/googlesansflex)
    resonance_download_asset(
        "${RESONANCE_GOOGLE_FONTS}/GoogleSansFlex%5BGRAD,ROND,opsz,slnt,wdth,wght%5D.ttf"
        "${RESONANCE_INTERFACE_FONT}"
        c31a482fbecbf2e07e6890134d20078723aadf732c9b9c6c9a44f86f8265b6fe)
    resonance_download_asset("${RESONANCE_GOOGLE_FONTS}/OFL.txt"
        "${RESONANCE_INTERFACE_FONT_LICENSE}"
        fc13d69f63e36d284b6e383d4d1463d8ad404f0aa065e57cf961252d51063137)
    if(NOT APPLE)
        install(FILES ${RESONANCE_INTERFACE_FONT} ${RESONANCE_INTERFACE_FONT_LICENSE}
            DESTINATION ${CMAKE_INSTALL_DATADIR}/resonance/fonts)
    endif()
endif()

# --- the app ---------------------------------------------------------------------

file(GLOB_RECURSE RESONANCE_SOURCES CONFIGURE_DEPENDS RELATIVE ${CMAKE_CURRENT_SOURCE_DIR}
    src/*.cpp src/*.h src/*.mm)
list(REMOVE_ITEM RESONANCE_SOURCES src/main.cpp)
if(NOT APPLE)
    list(FILTER RESONANCE_SOURCES EXCLUDE REGEX "^src/system/macos/")
endif()
if(NOT WIN32)
    list(FILTER RESONANCE_SOURCES EXCLUDE REGEX "^src/system/windows/")
endif()
if(NOT RESONANCE_DESKTOP_INTEGRATION)
    list(FILTER RESONANCE_SOURCES EXCLUDE REGEX "^src/system/linux/")
endif()
if(NOT TARGET Qt6::DBus)
    list(FILTER RESONANCE_SOURCES EXCLUDE REGEX "^src/system/dbus/")
endif()

file(GLOB_RECURSE RESONANCE_QML CONFIGURE_DEPENDS RELATIVE ${CMAKE_CURRENT_SOURCE_DIR}
    qml/*.qml)
file(GLOB RESONANCE_SINGLETONS CONFIGURE_DEPENDS RELATIVE ${CMAKE_CURRENT_SOURCE_DIR}
    qml/design/*.qml)
set_source_files_properties(${RESONANCE_SINGLETONS} PROPERTIES QT_QML_SINGLETON_TYPE TRUE)

file(GLOB RESONANCE_SHADERS CONFIGURE_DEPENDS RELATIVE ${CMAKE_CURRENT_SOURCE_DIR}
    shaders/*.frag shaders/*.vert)

qt_add_library(resonance_app STATIC)
qt_add_qml_module(resonance_app
    URI Resonance
    VERSION 1.0
    SOURCES ${RESONANCE_SOURCES}
    QML_FILES ${RESONANCE_QML}
    RESOURCES resources/resonance-icon.png resources/cameo.png resources/spotify.svg resources/soundcloud.svg
    DEPENDENCIES QtQuick QtWebEngine)
# BATCHABLE: the spectrum's material can be merged into the scene graph's
# batches, which needs the extra vertex input qsb adds for it.
qt_add_shaders(resonance_app "resonance_shaders"
    BATCHABLE
    PREFIX "/shaders"
    BASE shaders
    FILES ${RESONANCE_SHADERS})

# material 3's shapes as distance fields, for MaterialShape: drawn at build
# time from the vendored rounded-polygon-qmljs (tools/shape_atlas)
# the tool runs during the build, so a cross build (windows from a mac, say)
# takes one built for the machine doing the building
set(RESONANCE_SHAPE_ATLAS_TOOL "" CACHE FILEPATH
    "a shape_atlas built for the build machine, for cross builds")
if(RESONANCE_SHAPE_ATLAS_TOOL)
    set(RESONANCE_SHAPE_ATLAS_COMMAND ${RESONANCE_SHAPE_ATLAS_TOOL})
elseif(CMAKE_CROSSCOMPILING)
    message(FATAL_ERROR "a cross build needs -DRESONANCE_SHAPE_ATLAS_TOOL=<shape_atlas built for this machine>")
else()
    add_executable(shape_atlas tools/shape_atlas/main.cpp tools/shape_atlas/ShapeAtlasLayout.h)
    target_include_directories(shape_atlas PRIVATE tools/shape_atlas)
    target_link_libraries(shape_atlas PRIVATE Qt6::Core Qt6::Gui Qt6::Qml)
    # it runs on every fresh build, so it is optimised even in a debug one
    target_compile_options(shape_atlas PRIVATE $<$<CXX_COMPILER_ID:Clang,AppleClang,GNU>:-O2>)
    set(RESONANCE_SHAPE_ATLAS_COMMAND shape_atlas)
endif()
set(RESONANCE_SHAPE_LIBRARY ${CMAKE_CURRENT_SOURCE_DIR}/third_party/rounded-polygon-qmljs)
file(GLOB_RECURSE RESONANCE_SHAPE_SOURCES CONFIGURE_DEPENDS ${RESONANCE_SHAPE_LIBRARY}/*.js)
set(RESONANCE_SHAPE_ATLAS ${CMAKE_CURRENT_BINARY_DIR}/shapes/shape_atlas.png)
add_custom_command(OUTPUT ${RESONANCE_SHAPE_ATLAS}
    COMMAND ${CMAKE_COMMAND} -E make_directory ${CMAKE_CURRENT_BINARY_DIR}/shapes
    COMMAND ${RESONANCE_SHAPE_ATLAS_COMMAND} ${RESONANCE_SHAPE_LIBRARY} ${RESONANCE_SHAPE_ATLAS}
    DEPENDS ${RESONANCE_SHAPE_ATLAS_COMMAND} ${RESONANCE_SHAPE_SOURCES}
    COMMENT "Drawing the shape atlas")
qt_add_resources(resonance_app "resonance_shape_atlas"
    PREFIX "/shapes"
    BASE ${CMAKE_CURRENT_BINARY_DIR}/shapes
    FILES ${RESONANCE_SHAPE_ATLAS})

target_include_directories(resonance_app PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/src)
# qmltyperegistrar includes registered headers by file name alone, so every
# folder holding one is searched too. header names stay unique across src/.
set(RESONANCE_SOURCE_DIRECTORIES)
foreach(source IN LISTS RESONANCE_SOURCES)
    get_filename_component(directory ${CMAKE_CURRENT_SOURCE_DIR}/${source} DIRECTORY)
    list(APPEND RESONANCE_SOURCE_DIRECTORIES ${directory})
endforeach()
list(REMOVE_DUPLICATES RESONANCE_SOURCE_DIRECTORIES)
target_include_directories(resonance_app PRIVATE ${RESONANCE_SOURCE_DIRECTORIES})
# MaterialShapeItem finds a shape's cell the way the atlas tool lays them out
target_include_directories(resonance_app PRIVATE tools/shape_atlas)
target_compile_definitions(resonance_app PUBLIC RESONANCE_VERSION="${PROJECT_VERSION}")
target_compile_definitions(resonance_app PRIVATE
    RESONANCE_BUILD_FONT_DIRECTORY="${RESONANCE_FONT_DIRECTORY}")
# public, because main.cpp is the executable's own source rather than part of
# this library: a private definition would leave it out, and the desktop
# integration and mpris guards in it would compile away on the platform they
# exist for
target_compile_definitions(resonance_app PUBLIC
    $<$<BOOL:${RESONANCE_DESKTOP_INTEGRATION}>:RESONANCE_DESKTOP_INTEGRATION>
    $<$<TARGET_EXISTS:Qt6::DBus>:RESONANCE_HAS_DBUS>)
if(TARGET Qt6::DBus)
    target_link_libraries(resonance_app PUBLIC Qt6::DBus)
endif()
if(RESONANCE_DESKTOP_INTEGRATION)
    target_link_libraries(resonance_app PUBLIC PkgConfig::PULSE)
endif()
if(APPLE)
    target_link_libraries(resonance_app PUBLIC "-framework AppKit" "-framework MediaPlayer" "-framework QuartzCore")
    # now playing holds its objective-c objects with arc
    set_source_files_properties(src/system/macos/NowPlaying.mm src/system/macos/MacWindow.mm
        PROPERTIES COMPILE_OPTIONS -fobjc-arc)
endif()
target_link_libraries(resonance_app PUBLIC
    Qt6::Core Qt6::Gui Qt6::Network Qt6::Concurrent Qt6::Qml Qt6::Quick Qt6::QuickControls2 Qt6::Multimedia
    Qt6::WebEngineCore Qt6::WebEngineQuick
    QCoro6::Core QCoro6::Network
    qt6keychain
    material_color_utilities
    spotify_core)

if(WIN32)
    target_link_libraries(resonance_app PUBLIC Qt6::Widgets comctl32 dwmapi ole32 shell32 uuid)
endif()

qt_add_executable(resonance src/main.cpp)
target_link_libraries(resonance PRIVATE resonance_app resonance_appplugin)
if(RESONANCE_IS_LINUX)
    target_link_libraries(resonance PRIVATE Qt6::Widgets)
endif()
# a windowed app on windows, with no console window of its own
set_target_properties(resonance PROPERTIES WIN32_EXECUTABLE ON)
if(MINGW)
    # qt's WinMain shim reads msvcrt's __argc, which a mingw on ucrt (as
    # homebrew's is) lacks; mingw's own start-up calls main() just as well
    set_target_properties(resonance PROPERTIES qt_no_entrypoint ON)
endif()

# --- the soundcloud sidecar (go) ---------------------------------------------

# SoundCloud is read through its local Go API, built with the app so a normal
# source build has the service available. A prebuilt binary can still be used
# explicitly, or sidecar building can be disabled for builds that do not need it.
set(RESONANCE_SIDECAR_SOURCE_DIR ${CMAKE_CURRENT_SOURCE_DIR}/backend
    CACHE PATH "the Go local-api source directory")
set(RESONANCE_SIDECAR_BINARY "" CACHE FILEPATH "a built local-api, instead of building one")
option(RESONANCE_SIDECAR_BUILD "Build the soundcloud sidecar from its go source" ON)
set(RESONANCE_SIDECAR_FILE "")
if(RESONANCE_SIDECAR_BINARY)
    set(RESONANCE_SIDECAR_FILE ${RESONANCE_SIDECAR_BINARY})
elseif(RESONANCE_SIDECAR_BUILD)
    find_program(RESONANCE_GO_EXECUTABLE go)
    if(RESONANCE_GO_EXECUTABLE AND EXISTS "${RESONANCE_SIDECAR_SOURCE_DIR}/go.mod")
        file(GLOB_RECURSE RESONANCE_SIDECAR_SOURCES CONFIGURE_DEPENDS
            "${RESONANCE_SIDECAR_SOURCE_DIR}/*.go")
        # The go tool writes exactly the name it is given, so -o local-api on
        # windows produces a file called local-api with no .exe. Nothing can run
        # that: CreateProcess appends .exe to a name that carries no extension
        # and finds no such file. The app's own lookup missed it too —
        # QFileInfo::isExecutable() judges by extension on windows and has no
        # execute bit to read. The suffix is spelled out here instead of taken
        # from CMAKE_EXECUTABLE_SUFFIX, which only exists once a language is
        # enabled, and SidecarClient asks for the matching name.
        if(WIN32)
            set(RESONANCE_SIDECAR_NAME local-api.exe)
        else()
            set(RESONANCE_SIDECAR_NAME local-api)
        endif()
        set(RESONANCE_SIDECAR_FILE ${CMAKE_CURRENT_BINARY_DIR}/sidecar/${RESONANCE_SIDECAR_NAME})
        add_custom_command(OUTPUT ${RESONANCE_SIDECAR_FILE}
            COMMAND ${CMAKE_COMMAND} -E make_directory ${CMAKE_CURRENT_BINARY_DIR}/sidecar
            # CGO off: the result is one file with nothing to find at run time
            COMMAND ${CMAKE_COMMAND} -E env CGO_ENABLED=0 ${RESONANCE_GO_EXECUTABLE}
                build -trimpath "-ldflags=-s -w" -o ${RESONANCE_SIDECAR_FILE} ./cmd/local-api
            DEPENDS ${RESONANCE_SIDECAR_SOURCES}
            WORKING_DIRECTORY ${RESONANCE_SIDECAR_SOURCE_DIR}
            COMMENT "Building the soundcloud sidecar")
        add_custom_target(resonance_sidecar DEPENDS ${RESONANCE_SIDECAR_FILE})
        add_dependencies(resonance resonance_sidecar)
    elseif(EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/third_party/local-api/local-api")
        set(RESONANCE_SIDECAR_FILE ${CMAKE_CURRENT_SOURCE_DIR}/third_party/local-api/local-api)
    else()
        message(FATAL_ERROR
            "SoundCloud support is enabled, but Go or sidecar source is missing. "
            "Install Go and provide ${RESONANCE_SIDECAR_SOURCE_DIR}, set RESONANCE_SIDECAR_BINARY, "
            "or explicitly disable it with -DRESONANCE_SIDECAR_BUILD=OFF.")
    endif()
endif()
if(RESONANCE_SIDECAR_FILE)
    # the app looks beside itself first, and at the built one while developing
    target_compile_definitions(resonance_app PRIVATE
        RESONANCE_SIDECAR_PATH="${RESONANCE_SIDECAR_FILE}")
    if(APPLE)
        # before the signing below, which seals whatever is already inside
        add_custom_command(TARGET resonance POST_BUILD
            COMMAND ${CMAKE_COMMAND} -E copy_if_different ${RESONANCE_SIDECAR_FILE}
                $<TARGET_BUNDLE_DIR:resonance>/Contents/MacOS/local-api
            COMMAND chmod +x $<TARGET_BUNDLE_DIR:resonance>/Contents/MacOS/local-api
            COMMENT "Placing the soundcloud sidecar in the app")
    else()
        install(PROGRAMS ${RESONANCE_SIDECAR_FILE} DESTINATION ${CMAKE_INSTALL_BINDIR})
    endif()
endif()

# on macos, an app bundle: its own name in the menu bar and the dock, its own
# icon, and an identifier apart from the swift app's (com.addenator.Resonance)
if(APPLE)
    set(RESONANCE_ICON_SOURCE ${CMAKE_CURRENT_SOURCE_DIR}/packaging/icons)
    # the swift app's icon composer icon, compiled as xcode compiles it: an
    # asset catalog that macos 26 draws with its glass and its dark and tinted
    # looks, and an .icns for older systems. without xcode's actool, or with one
    # that cannot open this .icon bundle, an .icns made from the rendered pngs
    # instead.
    option(RESONANCE_ICON_ASSET_CATALOG
        "Compile packaging/icons/resonance.icon with actool, when actool accepts it" ON)
    execute_process(COMMAND xcrun --find actool
        OUTPUT_VARIABLE RESONANCE_ACTOOL OUTPUT_STRIP_TRAILING_WHITESPACE ERROR_QUIET)
    if(RESONANCE_ACTOOL AND RESONANCE_ICON_ASSET_CATALOG)
        # actool is only trusted with the .icon bundle once it has compiled it
        # here, at configure time. the first release runs died at the last build
        # step with 'Could not open "resonance.icon"' — a build-machine xcode
        # that would not take the bundle — and probing is the difference between
        # falling back to the png icon and failing the build.
        file(MAKE_DIRECTORY ${CMAKE_CURRENT_BINARY_DIR}/icon-probe)
        execute_process(
            COMMAND ${RESONANCE_ACTOOL} --compile ${CMAKE_CURRENT_BINARY_DIR}/icon-probe
                --platform macosx --minimum-deployment-target 13.0 --app-icon resonance
                --output-partial-info-plist ${CMAKE_CURRENT_BINARY_DIR}/icon-probe/icon.plist
                ${RESONANCE_ICON_SOURCE}/resonance.icon
            RESULT_VARIABLE RESONANCE_ACTOOL_RESULT
            OUTPUT_QUIET ERROR_QUIET)
        if(NOT RESONANCE_ACTOOL_RESULT STREQUAL "0")
            message(STATUS "actool cannot compile resonance.icon; the png icon is used instead")
            set(RESONANCE_ACTOOL "")
        endif()
    else()
        set(RESONANCE_ACTOOL "")
    endif()
    if(RESONANCE_ACTOOL)
        set(RESONANCE_ICON_OUTPUT ${CMAKE_CURRENT_BINARY_DIR}/icon)
        file(GLOB RESONANCE_ICON_PARTS LIST_DIRECTORIES false CONFIGURE_DEPENDS ${RESONANCE_ICON_SOURCE}/resonance.icon/*
            ${RESONANCE_ICON_SOURCE}/resonance.icon/Assets/*)
        add_custom_command(OUTPUT ${RESONANCE_ICON_OUTPUT}/Assets.car ${RESONANCE_ICON_OUTPUT}/resonance.icns
            COMMAND ${CMAKE_COMMAND} -E make_directory ${RESONANCE_ICON_OUTPUT}
            COMMAND ${RESONANCE_ACTOOL} --compile ${RESONANCE_ICON_OUTPUT} --platform macosx
                --minimum-deployment-target 13.0 --app-icon resonance
                --output-partial-info-plist ${RESONANCE_ICON_OUTPUT}/icon.plist
                ${RESONANCE_ICON_SOURCE}/resonance.icon > /dev/null
            DEPENDS ${RESONANCE_ICON_PARTS}
            COMMENT "Compiling the app icon")
        set(RESONANCE_ICON_FILES ${RESONANCE_ICON_OUTPUT}/Assets.car ${RESONANCE_ICON_OUTPUT}/resonance.icns)
    else()
        set(RESONANCE_ICONSET ${CMAKE_CURRENT_BINARY_DIR}/resonance.iconset)
        set(RESONANCE_ICNS ${CMAKE_CURRENT_BINARY_DIR}/resonance.icns)
        add_custom_command(OUTPUT ${RESONANCE_ICNS}
            COMMAND ${CMAKE_COMMAND} -E make_directory ${RESONANCE_ICONSET}
            COMMAND sips -z 16 16 ${RESONANCE_ICON_SOURCE}/resonance-32.png --out ${RESONANCE_ICONSET}/icon_16x16.png > /dev/null
            COMMAND ${CMAKE_COMMAND} -E copy ${RESONANCE_ICON_SOURCE}/resonance-32.png ${RESONANCE_ICONSET}/icon_16x16@2x.png
            COMMAND ${CMAKE_COMMAND} -E copy ${RESONANCE_ICON_SOURCE}/resonance-32.png ${RESONANCE_ICONSET}/icon_32x32.png
            COMMAND ${CMAKE_COMMAND} -E copy ${RESONANCE_ICON_SOURCE}/resonance-64.png ${RESONANCE_ICONSET}/icon_32x32@2x.png
            COMMAND ${CMAKE_COMMAND} -E copy ${RESONANCE_ICON_SOURCE}/resonance-128.png ${RESONANCE_ICONSET}/icon_128x128.png
            COMMAND ${CMAKE_COMMAND} -E copy ${RESONANCE_ICON_SOURCE}/resonance-256.png ${RESONANCE_ICONSET}/icon_128x128@2x.png
            COMMAND ${CMAKE_COMMAND} -E copy ${RESONANCE_ICON_SOURCE}/resonance-256.png ${RESONANCE_ICONSET}/icon_256x256.png
            COMMAND ${CMAKE_COMMAND} -E copy ${RESONANCE_ICON_SOURCE}/resonance-512.png ${RESONANCE_ICONSET}/icon_256x256@2x.png
            COMMAND ${CMAKE_COMMAND} -E copy ${RESONANCE_ICON_SOURCE}/resonance-512.png ${RESONANCE_ICONSET}/icon_512x512.png
            COMMAND iconutil --convert icns --output ${RESONANCE_ICNS} ${RESONANCE_ICONSET}
            DEPENDS ${RESONANCE_ICON_SOURCE}/resonance-32.png ${RESONANCE_ICON_SOURCE}/resonance-64.png
                ${RESONANCE_ICON_SOURCE}/resonance-128.png ${RESONANCE_ICON_SOURCE}/resonance-256.png
                ${RESONANCE_ICON_SOURCE}/resonance-512.png
            COMMENT "Making the app icon")
        set(RESONANCE_ICON_FILES ${RESONANCE_ICNS})
    endif()
    set_source_files_properties(${RESONANCE_ICON_FILES} PROPERTIES MACOSX_PACKAGE_LOCATION Resources)
    target_sources(resonance PRIVATE ${RESONANCE_ICON_FILES})
    if(RESONANCE_ICON_FONT)
        set_source_files_properties(${RESONANCE_ICON_FONT} PROPERTIES MACOSX_PACKAGE_LOCATION Resources/fonts)
        target_sources(resonance PRIVATE ${RESONANCE_ICON_FONT})
    endif()
    if(RESONANCE_INTERFACE_FONT)
        set_source_files_properties(${RESONANCE_INTERFACE_FONT} ${RESONANCE_INTERFACE_FONT_LICENSE}
            PROPERTIES MACOSX_PACKAGE_LOCATION Resources/fonts)
        target_sources(resonance PRIVATE ${RESONANCE_INTERFACE_FONT} ${RESONANCE_INTERFACE_FONT_LICENSE})
    endif()
    set_target_properties(resonance PROPERTIES
        MACOSX_BUNDLE ON
        MACOSX_BUNDLE_INFO_PLIST ${CMAKE_CURRENT_SOURCE_DIR}/packaging/macos/Info.plist.in
        MACOSX_BUNDLE_BUNDLE_NAME Resonance
        MACOSX_BUNDLE_GUI_IDENTIFIER com.resonance.desktop
        MACOSX_BUNDLE_ICON_FILE resonance.icns
        MACOSX_BUNDLE_SHORT_VERSION_STRING ${PROJECT_VERSION}
        MACOSX_BUNDLE_BUNDLE_VERSION ${PROJECT_VERSION})
    # the linker signs only the executable; signing the bundle seals the icon
    # and the font in with it, so the whole app checks out. a folder synced by
    # icloud tags files with finder and file-provider attributes, which
    # codesign refuses to seal, so they go first.
    # ad hoc by default. an identity of one's own keeps the signature's
    # requirement the same from build to build, so the keychain hands over
    # the stored logins without asking again after each one
    set(RESONANCE_CODESIGN_IDENTITY "-" CACHE STRING "codesign identity for the app bundle; - signs ad hoc")
    add_custom_command(TARGET resonance POST_BUILD
        COMMAND xattr -cr $<TARGET_BUNDLE_DIR:resonance>
        COMMAND codesign --force --sign ${RESONANCE_CODESIGN_IDENTITY} $<TARGET_BUNDLE_DIR:resonance>
        COMMENT "Signing the app bundle")
endif()

if(BUILD_TESTING)
    add_subdirectory(tests)
endif()

install(TARGETS resonance
    RUNTIME DESTINATION ${CMAKE_INSTALL_BINDIR}
    BUNDLE DESTINATION .)
if(NOT APPLE AND NOT WIN32)
    # the desktop entry's name is the wayland app id (see main.cpp), which is
    # how hyprland and the tray match the window to its icon
    install(FILES packaging/resonance.desktop DESTINATION ${CMAKE_INSTALL_DATADIR}/applications)
    foreach(size 32 48 64 128 256 512)
        install(FILES packaging/icons/resonance-${size}.png
            DESTINATION ${CMAKE_INSTALL_DATADIR}/icons/hicolor/${size}x${size}/apps
            RENAME resonance.png)
    endforeach()
endif()
