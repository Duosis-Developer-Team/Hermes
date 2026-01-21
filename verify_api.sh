#!/bin/bash

# Base URLs
AUTH_URL="http://localhost:8000/api/v1/auth"
CORE_URL="http://localhost:8001/api/v1/core"

echo "======================================"
echo " HERMES API VERIFICATION"
echo "======================================"

# 1. Login to get Token
echo "[1] Authenticating (admin@hermes.com)..."
LOGIN_RES=$(curl -s -X POST "$AUTH_URL/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "username=admin@hermes.dev&password=admin123")

# Extract Token (Basic parsing)
TOKEN=$(echo "$LOGIN_RES" | grep -o '"access_token":"[^"]*' | cut -d'"' -f4)

if [ -z "$TOKEN" ] || [ "$TOKEN" == "null" ]; then
    echo "❌ FAILED: Login failed."
    echo "Response: $LOGIN_RES"
    exit 1
fi
echo "✅ SUCCESS: Token Received"

# Function to test endpoint
test_endpoint() {
    NAME=$1
    URL=$2
    
    echo -n "Checking $NAME... "
    CODE=$(curl -o /dev/null -s -w "%{http_code}" -X GET "$URL" -H "Authorization: Bearer $TOKEN")
    
    if [ "$CODE" == "200" ]; then
        echo "✅ OK (200)"
    else
        echo "❌ FAILED ($CODE)"
        echo "   URL: $URL"
    fi
}

echo "--------------------------------------"
echo "[2] Verifying Core Endpoints..."

test_endpoint "Customers" "$CORE_URL/customers"
test_endpoint "Projects" "$CORE_URL/projects"
test_endpoint "Activity Types" "$CORE_URL/activity-types"
test_endpoint "Work Types" "$CORE_URL/work-types"
test_endpoint "Work Logs (All)" "$CORE_URL/work-logs/all"
test_endpoint "Platforms" "$CORE_URL/platforms"
test_endpoint "Work Lines" "$CORE_URL/work-lines"
test_endpoint "Issues" "$CORE_URL/issues"

echo "--------------------------------------"
echo "Verification Complete."
