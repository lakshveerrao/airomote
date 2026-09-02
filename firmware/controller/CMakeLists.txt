# Aero controller firmware — plain ESP-IDF project (also built by PlatformIO, see platformio.ini).
#   idf.py set-target esp32c6 && idf.py build
cmake_minimum_required(VERSION 3.16)
include($ENV{IDF_PATH}/tools/cmake/project.cmake)
project(aero_controller)
