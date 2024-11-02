#!/bin/bash
./genindex.js
git add -A
git commit -m "updates"
git push origin main
