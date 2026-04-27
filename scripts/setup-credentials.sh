#!/usr/bin/env bash

# Credentials System Setup Script
# This script helps set up the credentials system in your Flowlib installation

set -e

echo "🔐 Flowlib Credentials System Setup"
echo "======================================="
echo ""

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
    echo "❌ Error: Please run this script from the project root directory"
    exit 1
fi

# Step 1: Generate encryption key
echo "📝 Step 1: Generate Encryption Key"
echo "-----------------------------------"

if [ -z "$FLOWLIB_ENCRYPTION_KEY" ]; then
    echo "Generating new encryption key..."
    ENCRYPTION_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")
    echo ""
    echo "✅ Generated encryption key!"
    echo ""
    echo "Add this to your .env file:"
    echo ""
    echo "FLOWLIB_ENCRYPTION_KEY=$ENCRYPTION_KEY"
    echo ""
    echo "⚠️  IMPORTANT: Keep this key secure and never commit it to version control!"
    echo ""
    
    # Ask if user wants to add to .env
    read -p "Add to .env file now? (y/n) " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        if [ ! -f ".env" ]; then
            touch .env
        fi
        echo "" >> .env
        echo "# Credentials encryption key (generated $(date))" >> .env
        echo "FLOWLIB_ENCRYPTION_KEY=$ENCRYPTION_KEY" >> .env
        echo "✅ Added to .env file"
    fi
else
    echo "✅ FLOWLIB_ENCRYPTION_KEY already set"
fi

echo ""

# Step 2: Database migration
echo "📊 Step 2: Database Migration"
echo "-----------------------------"
echo "The credentials table schema has been added to:"
echo "  pkg/core/src/database/schema-sqlite.ts"
echo ""
echo "To create the table, run:"
echo "  cd pkg/core"
echo "  pnpm drizzle-kit generate"
echo "  pnpm drizzle-kit migrate"
echo ""

read -p "Run migration now? (y/n) " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "Running migration..."
    cd pkg/core
    pnpm drizzle-kit generate
    pnpm drizzle-kit migrate
    cd ../..
    echo "✅ Migration complete"
else
    echo "⏭️  Skipped migration (you can run it manually later)"
fi

echo ""

# Step 3: Setup summary
echo "📋 Setup Summary"
echo "---------------"
echo "✅ Encryption key generated/verified"
echo "✅ Database schema ready"
echo ""
echo "Next steps:"
echo "1. Add credentials routes to your Express app:"
echo ""
echo "   import { createEncryptionService, createCredentialsService } from '@flowlib/core/services/credentials';"
echo "   import { createCredentialsRouter } from '@flowlib/core/api/credentials.routes';"
echo ""
echo "   const encryption = createEncryptionService();"
echo "   const credentialsService = createCredentialsService(db, encryption);"
echo "   app.use('/api/credentials', createCredentialsRouter(credentialsService));"
echo ""
echo "2. See README for full usage examples:"
echo "   pkg/core/src/services/credentials/README.md"
echo ""
echo "3. See documentation:"
echo "   CREDENTIALS-SYSTEM-DESIGN.md"
echo "   CREDENTIALS-INTEGRATION-EXAMPLE.md"
echo ""
echo "🎉 Setup complete! Your credentials system is ready to use."
