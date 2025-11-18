#!/bin/bash

echo "🔧 Building and checking types..."

# Step 1: Build server to generate JavaScript
echo "📦 Building server..."
bun run --filter server build

# Step 2: Generate TypeScript declarations
echo "📝 Generating TypeScript declarations..."
cd apps/server
bun tsc --emitDeclarationOnly --skipLibCheck
cd ../..

# Step 3: Build all applications
echo "🏗️ Building all applications..."
bun run build

# Step 4: Check types for all applications
echo "✅ Checking types..."
bun run --filter server check-types
bun run --filter web check-types

echo "🎉 Build and type checking completed successfully!"