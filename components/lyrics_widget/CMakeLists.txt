cmake_minimum_required(VERSION 3.16)

# usable both on its own and through add_subdirectory()
if(CMAKE_SOURCE_DIR STREQUAL CMAKE_CURRENT_SOURCE_DIR)
    project(lyrics_widget LANGUAGES CXX)
endif()

# Standalone Qt Widgets lyric view for LRCLIB. The Resonance application is
# built on Qt Quick, so this module is kept opt-in instead of being globbed
# into the app's own sources: add_subdirectory() it from a widget application,
# or copy the four files into an existing target.
#
#   add_subdirectory(components/lyrics_widget)
#   target_link_libraries(my_app PRIVATE lyrics_widget)

find_package(QT NAMES Qt6 Qt5 REQUIRED COMPONENTS Core Network Widgets)
find_package(Qt${QT_VERSION_MAJOR} REQUIRED COMPONENTS Core Network Widgets)

add_library(lyrics_widget STATIC
    LyricsManager.h
    LyricsManager.cpp
    LyricsWidget.h
    LyricsWidget.cpp)
add_library(resonance::lyrics_widget ALIAS lyrics_widget)

target_include_directories(lyrics_widget PUBLIC ${CMAKE_CURRENT_SOURCE_DIR})
target_link_libraries(lyrics_widget PUBLIC
    Qt${QT_VERSION_MAJOR}::Core
    Qt${QT_VERSION_MAJOR}::Network
    Qt${QT_VERSION_MAJOR}::Widgets)

set_target_properties(lyrics_widget PROPERTIES
    AUTOMOC ON
    CXX_STANDARD 17
    CXX_STANDARD_REQUIRED ON
    CXX_EXTENSIONS OFF)

if(MSVC)
    target_compile_options(lyrics_widget PRIVATE /utf-8)
endif()
