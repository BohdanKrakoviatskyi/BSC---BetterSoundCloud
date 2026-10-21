add_test(NAME download_asset
    COMMAND ${CMAKE_COMMAND} "-DTEST_DIRECTORY=${CMAKE_CURRENT_BINARY_DIR}/download_asset"
        -P ${CMAKE_CURRENT_SOURCE_DIR}/check_download_asset.cmake)

function(resonance_test name)
    qt_add_executable(${name} ${name}.cpp ${ARGN})
    target_link_libraries(${name} PRIVATE resonance_app Qt6::Test)
    add_test(NAME ${name} COMMAND ${name})
    set_tests_properties(${name} PROPERTIES ENVIRONMENT "QT_QPA_PLATFORM=offscreen")
endfunction()

resonance_test(tst_settings)
resonance_test(tst_theme)
resonance_test(tst_playback FakeCore.h)
resonance_test(tst_palette)
resonance_test(tst_spectrum FakeCore.h)
resonance_test(tst_covers)
resonance_test(tst_local FakeCore.h)
resonance_test(tst_session FakeCore.h)
resonance_test(tst_soundcloud)
add_executable(tst_soundcloud_sidecar fake_soundcloud_sidecar.cpp)
target_link_libraries(tst_soundcloud_sidecar PRIVATE Qt6::Core)
add_dependencies(tst_soundcloud tst_soundcloud_sidecar)
set_tests_properties(tst_soundcloud PROPERTIES
    ENVIRONMENT "QT_QPA_PLATFORM=offscreen;RESONANCE_SIDECAR=$<TARGET_FILE:tst_soundcloud_sidecar>")

# these two tests use QRhi internals, which are optional Qt development packages
set(QT_NO_PRIVATE_MODULE_WARNING ON)
find_package(Qt6 QUIET COMPONENTS GuiPrivate)
if(TARGET Qt6::GuiPrivate)
    resonance_test(tst_views FakeCore.h)
    target_link_libraries(tst_views PRIVATE resonance_appplugin Qt6::GuiPrivate)
else()
    message(STATUS "Skipping tst_views: Qt6::GuiPrivate is not installed")
endif()

if(WIN32)
    find_program(RESONANCE_POWERSHELL NAMES powershell pwsh)
    if(RESONANCE_POWERSHELL)
        add_test(NAME windows_build_script
            COMMAND ${RESONANCE_POWERSHELL} -NoProfile -ExecutionPolicy Bypass
                -File ${CMAKE_CURRENT_SOURCE_DIR}/check_windows_build.ps1)
    endif()
    if(TARGET Qt6::GuiPrivate)
        resonance_test(tst_windows FakeCore.h)
        target_link_libraries(tst_windows PRIVATE resonance_appplugin Qt6::GuiPrivate)
    endif()
endif()

# what a frame of the main window costs: run by hand, not by ctest
find_package(Qt6 QUIET COMPONENTS QuickPrivate)
if(TARGET Qt6::GuiPrivate AND TARGET Qt6::QuickPrivate)
    qt_add_executable(bench_frames bench_frames.cpp FakeCore.h ViewRig.h)
    target_link_libraries(bench_frames PRIVATE resonance_app resonance_appplugin Qt6::Test Qt6::GuiPrivate Qt6::QuickPrivate)
else()
    message(STATUS "Skipping bench_frames: Qt6 private development packages are not installed")
endif()

# every material symbol the qml names exists in the pinned font
find_package(Python3 COMPONENTS Interpreter)
if(Python3_FOUND AND RESONANCE_ICON_CODEPOINTS)
    add_test(NAME icon_names
        COMMAND Python3::Interpreter ${CMAKE_CURRENT_SOURCE_DIR}/check_icon_names.py
            ${RESONANCE_ICON_CODEPOINTS} ${PROJECT_SOURCE_DIR}/qml)
endif()
# a script line opening with a bracket runs on from the one before
if(Python3_FOUND)
    add_test(NAME qml_statements
        COMMAND Python3::Interpreter ${CMAKE_CURRENT_SOURCE_DIR}/check_qml_statements.py ${PROJECT_SOURCE_DIR}/qml)
endif()
