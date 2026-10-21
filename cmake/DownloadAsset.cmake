function(resonance_download_asset url destination sha256)
    if(EXISTS "${destination}")
        file(SHA256 "${destination}" actual_hash)
        if(actual_hash STREQUAL sha256)
            return()
        endif()
    endif()

    get_filename_component(directory "${destination}" DIRECTORY)
    file(MAKE_DIRECTORY "${directory}")
    set(temporary "${destination}.download")
    message(STATUS "Downloading ${destination}")
    file(DOWNLOAD "${url}" "${temporary}" STATUS download_status TLS_VERIFY ON)
    list(GET download_status 0 download_result)
    list(GET download_status 1 download_message)

    if(download_result AND WIN32)
        find_program(RESONANCE_CURL_EXECUTABLE NAMES curl.exe
            HINTS "$ENV{SystemRoot}/System32")
        if(RESONANCE_CURL_EXECUTABLE)
            execute_process(
                COMMAND "${RESONANCE_CURL_EXECUTABLE}" --fail --location --silent --show-error
                    --output "${temporary}" "${url}"
                RESULT_VARIABLE download_result
                ERROR_VARIABLE download_message)
        endif()
    endif()

    if(NOT "${download_result}" STREQUAL "0")
        file(REMOVE "${temporary}")
        message(FATAL_ERROR "Could not download ${url}: ${download_message}")
    endif()

    file(SHA256 "${temporary}" actual_hash)
    if(NOT actual_hash STREQUAL sha256)
        file(REMOVE "${temporary}")
        message(FATAL_ERROR "SHA256 mismatch for ${url}: expected ${sha256}, got ${actual_hash}")
    endif()
    file(RENAME "${temporary}" "${destination}")
endfunction()
