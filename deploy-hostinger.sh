#!/bin/bash

# 1. Install dependencies
echo "Installing dependencies..."
npm install

# 2. Build the project
echo "Building the project..."
npm run build

# 3. Zip the dist folder
echo "Zipping the dist folder..."
if command -v zip >/dev/null 2>&1; then
    cd dist
    zip -r ../deploy.zip .
    cd ..
    echo "Success! Your deployment file is 'deploy.zip'."
    echo "Upload the contents of this zip to your Hostinger 'public_html' folder."
else
    echo "Error: 'zip' utility not found. Please zip the 'dist' folder manually."
fi
