@echo off
cd /d "%~dp0"
py -3 serve_map.py
if errorlevel 1 pause