# Credential Management E2E Tests

## Application Overview

Test plan for the Flowlib credential management system. Covers CRUD operations on the /flowlib/credentials page (create, read, update, delete), auth type variations (Bearer, API Key, Basic, Connection String), the test-connection feature, credential webhook lifecycle (enable, display URL/secret, ingest), and integration with flow execution. The credentials page is a React SPA at /flowlib/credentials backed by Express API routes at /api/credentials/\*. Credential secrets are AES-256-GCM encrypted at rest. Two seeded credentials exist: "Anthropic API Key" (bearer) and "Linear OAuth2" (oauth2, webhook-enabled).

## Test Scenarios

### 1. Credential CRUD — Create

**Seed:** `tests/seed.spec.ts`

#### 1.1. create a bearer token credential via the modal

**File:** `tests/credentials/crud-create.spec.ts`

**Steps:**

1. Navigate to /flowlib/credentials
   - expect: The 'Credentials' heading is visible
   - expect: The existing seeded credentials are listed

2. Click the 'New Credential' button
   - expect: The 'Create Credential' dialog opens with title 'Create Credential'
   - expect: The Name field is focused

3. Fill in Name as 'Test Bearer Cred', leave type as 'HTTP API' and auth type as 'Bearer Token'
   - expect: The Token field appears inside the config section

4. Type 'sk-test-12345' into the Token field
   - expect: The Token field is a password type (masked)

5. Click 'Create Credential' button
   - expect: The dialog closes
   - expect: The credential 'Test Bearer Cred' appears in the list with a 'Bearer' badge

#### 1.2. create an API Key credential with custom parameter name

**File:** `tests/credentials/crud-create.spec.ts`

**Steps:**

1. Navigate to /flowlib/credentials and click 'New Credential'
   - expect: The Create Credential dialog opens

2. Fill Name as 'My API Key Cred', select auth type 'API Key'
   - expect: The API Key field, Location dropdown, and Parameter Name field appear

3. Enter 'abc-key-999' in the API Key field, select 'Header' for Location, type 'X-Custom-Key' for Parameter Name
   - expect: All three fields show entered values

4. Click 'Create Credential'
   - expect: The dialog closes
   - expect: The credential 'My API Key Cred' appears in the list with an 'API Key' badge

#### 1.3. create a Basic Auth credential

**File:** `tests/credentials/crud-create.spec.ts`

**Steps:**

1. Navigate to /flowlib/credentials and click 'New Credential'
   - expect: The Create Credential dialog opens

2. Fill Name as 'Basic Auth Cred', select auth type 'Basic Auth'
   - expect: Username and Password fields appear

3. Enter 'admin' for Username and 'secret123' for Password, click 'Create Credential'
   - expect: The dialog closes
   - expect: The credential 'Basic Auth Cred' appears with a 'Basic' badge

#### 1.4. create a Database connection string credential

**File:** `tests/credentials/crud-create.spec.ts`

**Steps:**

1. Navigate to /flowlib/credentials and click 'New Credential'
   - expect: The Create Credential dialog opens

2. Select 'Database' for Credential Type
   - expect: Auth Type dropdown shows only 'Basic Auth' and 'Connection String' options

3. Select 'Connection String' for Auth Type, fill Name as 'Postgres Dev DB'
   - expect: Connection String field appears with postgres placeholder

4. Enter 'postgres://user:pass@localhost:5432/testdb' and click 'Create Credential'
   - expect: Dialog closes
   - expect: 'Postgres Dev DB' appears in list with a 'Connection' badge

#### 1.5. cannot create a credential without a name

**File:** `tests/credentials/crud-create.spec.ts`

**Steps:**

1. Navigate to /flowlib/credentials and click 'New Credential'
   - expect: Dialog opens with Name field focused

2. Leave Name empty, enter a token value, and click 'Create Credential'
   - expect: The form does not submit (HTML required validation fires)
   - expect: Dialog remains open

### 2. Credential CRUD — Read & Detail View

**Seed:** `tests/seed.spec.ts`

#### 2.1. view credential detail panel shows overview metadata

**File:** `tests/credentials/crud-read.spec.ts`

**Steps:**

1. Navigate to /flowlib/credentials
   - expect: The credentials list shows 'Anthropic API Key' with a 'Bearer' badge and an active status dot

2. Click on the 'Anthropic API Key' row
   - expect: A detail dialog opens showing the credential name in the title
   - expect: The Overview tab is selected by default
   - expect: Status shows 'Active' with a green badge
   - expect: Auth Type shows 'Bearer'
   - expect: Type shows 'HTTP API'
   - expect: Created and Updated dates are displayed

3. Observe the description field
   - expect: Description reads 'Anthropic Claude API credential for AI model nodes'

#### 2.2. search filters credentials by name

**File:** `tests/credentials/crud-read.spec.ts`

**Steps:**

1. Navigate to /flowlib/credentials
   - expect: All credentials are visible in the list

2. Type 'Anthropic' into the search field
   - expect: Only 'Anthropic API Key' is visible
   - expect: Other credentials are filtered out

3. Clear the search field
   - expect: All credentials reappear

4. Type 'nonexistent-xyz' into the search field
   - expect: 'No credentials match your search.' message is displayed

#### 2.3. auth type filter pills narrow the list

**File:** `tests/credentials/crud-read.spec.ts`

**Steps:**

1. Navigate to /flowlib/credentials
   - expect: The filter pills show 'All' plus one pill per auth type present in the data

2. Click the 'Bearer' filter pill
   - expect: Only bearer-type credentials are shown (e.g. 'Anthropic API Key')
   - expect: OAuth2-type credentials are hidden

3. Click the 'Bearer' pill again to deselect
   - expect: All credentials reappear (filter resets to 'All')

#### 2.4. detail dialog has Overview, Edit, and Webhook tabs

**File:** `tests/credentials/crud-read.spec.ts`

**Steps:**

1. Navigate to /flowlib/credentials and click on a credential row
   - expect: Detail dialog opens with three tabs: 'Overview', 'Edit', and 'Webhook'

2. Click the 'Edit' tab
   - expect: The edit form is shown with pre-populated Name, Type, Auth Type, and Description fields

3. Click the 'Webhook' tab
   - expect: The webhook section is displayed, showing either an 'Enable Webhook' button or webhook URL/secret if already enabled

4. Click the 'Overview' tab to return
   - expect: The overview section is shown again with status metadata and Test Connection panel

### 3. Credential CRUD — Update

**Seed:** `tests/seed.spec.ts`

#### 3.1. edit credential name and description

**File:** `tests/credentials/crud-update.spec.ts`

**Steps:**

1. Navigate to /flowlib/credentials and click on 'Anthropic API Key'
   - expect: Detail dialog opens on the Overview tab

2. Click the 'Edit' tab
   - expect: Edit form shows with Name pre-populated as 'Anthropic API Key'

3. Change Name to 'Anthropic API Key (Updated)', change Description to 'Updated description'
   - expect: Fields reflect the new values

4. Click 'Save Changes'
   - expect: The view returns to the Overview tab
   - expect: The dialog title now shows 'Anthropic API Key (Updated)'

5. Close the dialog and verify the list
   - expect: The credential list shows 'Anthropic API Key (Updated)' instead of the old name

#### 3.2. toggle credential active/inactive status

**File:** `tests/credentials/crud-update.spec.ts`

**Steps:**

1. Navigate to /flowlib/credentials and open a credential's detail dialog
   - expect: Overview shows 'Active' status badge

2. Click 'Edit' tab, uncheck the 'Active' checkbox
   - expect: The checkbox is unchecked

3. Click 'Save Changes'
   - expect: View returns to Overview
   - expect: Status now shows 'Inactive' badge

4. Click 'Edit' again, re-check 'Active', save
   - expect: Status returns to 'Active'

#### 3.3. edit cancel discards changes

**File:** `tests/credentials/crud-update.spec.ts`

**Steps:**

1. Open a credential detail dialog, go to 'Edit' tab
   - expect: Edit form is shown

2. Change the Name field to something different
   - expect: Name field reflects the new text

3. Click 'Cancel' button in the edit form
   - expect: View returns to Overview tab
   - expect: The original credential name is displayed (change was discarded)

### 4. Credential CRUD — Delete

**Seed:** `tests/seed.spec.ts`

#### 4.1. delete a credential with confirmation

**File:** `tests/credentials/crud-delete.spec.ts`

**Steps:**

1. Navigate to /flowlib/credentials, create a new bearer credential named 'Cred To Delete'
   - expect: 'Cred To Delete' appears in the list

2. Click on 'Cred To Delete' to open detail dialog
   - expect: Detail dialog opens

3. Click the 'Delete' button at the bottom of the Overview tab
   - expect: A confirmation dialog appears with title 'Delete Credential?'
   - expect: Message says 'Are you sure you want to delete "Cred To Delete"?'

4. Click 'Delete' in the confirmation dialog
   - expect: Both dialogs close
   - expect: 'Cred To Delete' is removed from the credentials list

#### 4.2. cancel delete preserves the credential

**File:** `tests/credentials/crud-delete.spec.ts`

**Steps:**

1. Navigate to /flowlib/credentials and open a credential's detail dialog
   - expect: Detail dialog opens with Overview tab

2. Click 'Delete' button
   - expect: Confirmation dialog appears

3. Click 'Cancel' in the confirmation dialog
   - expect: Confirmation dialog closes
   - expect: Detail dialog remains open
   - expect: The credential still exists in the list

### 5. Credential Test Connection

**Seed:** `tests/seed.spec.ts`

#### 5.1. test connection from detail dialog shows success or failure

**File:** `tests/credentials/test-connection.spec.ts`

**Steps:**

1. Navigate to /flowlib/credentials and click on 'Anthropic API Key'
   - expect: Detail dialog opens on Overview tab
   - expect: A 'Test Connection' section is visible with a 'Test' button

2. Click the 'Test' button
   - expect: Button shows 'Testing…' with a spinner
   - expect: After the test completes, a result message appears — either '✓ Connection successful' (green) or '✗ Failed: ...' (red)

#### 5.2. inline test during credential creation

**File:** `tests/credentials/test-connection.spec.ts`

**Steps:**

1. Navigate to /flowlib/credentials, click 'New Credential'
   - expect: Create dialog opens

2. Fill Name 'Test Inline Cred', auth type 'Bearer Token', Token 'fake-token'
   - expect: A 'Test Credential' section appears below the config fields with a URL input and method selector

3. Enter 'https://httpbin.org/get' in the test URL field, leave method as GET
   - expect: The 'Test' button becomes enabled

4. Click 'Test' button in the create modal
   - expect: Spinner appears
   - expect: After request completes, shows connection result (success status or error)

5. Click 'Cancel' to close without saving
   - expect: Dialog closes, no credential was created

### 6. Credential Webhooks — Enable & Display

**Seed:** `tests/seed.spec.ts`

#### 6.1. enable webhook on a credential and view URL and secret

**File:** `tests/credentials/webhooks.spec.ts`

**Steps:**

1. Navigate to /flowlib/credentials, create a new bearer credential named 'Webhook Test Cred'
   - expect: 'Webhook Test Cred' appears in the list

2. Click 'Webhook Test Cred' to open detail, then click the 'Webhook' tab
   - expect: Shows 'Webhooks not enabled for this credential' message
   - expect: 'Enable Webhook' button is visible

3. Click 'Enable Webhook' button
   - expect: Button briefly shows 'Enabling…' with spinner
   - expect: Then the webhook URL and secret are displayed
   - expect: URL field shows a path like '/webhooks/credentials/...'
   - expect: Secret field is masked by default

4. Observe the descriptive text below the webhook info
   - expect: Text says 'External services send events to this URL. All flows with a Webhook Trigger node referencing this credential will be triggered automatically.'

#### 6.2. existing webhook-enabled credential shows URL on webhook tab

**File:** `tests/credentials/webhooks.spec.ts`

**Steps:**

1. Navigate to /flowlib/credentials and click on 'Linear OAuth2' (already has webhook enabled)
   - expect: Detail dialog opens

2. Click the 'Webhook' tab
   - expect: Webhook URL is displayed immediately (no 'Enable' button)
   - expect: Secret is displayed (masked)
   - expect: URL contains '/webhooks/credentials/'

### 7. Webhook Ingestion — Trigger a Flow via Credential Webhook

**Seed:** `tests/seed.spec.ts`

#### 7.1. POST to credential webhook URL triggers the associated flow

**File:** `tests/credentials/webhook-ingestion.spec.ts`

**Steps:**

1. Use the API to get the webhook info for the 'Linear OAuth2' credential (GET /flowlib/credentials/:id/webhook-info)
   - expect: Response contains webhookPath and webhookSecret

2. Send a POST request to http://localhost:3000/flowlib/webhooks/credentials/{webhookPath} with a JSON body { "action": "test", "data": { "issueId": "TEST-123" } }
   - expect: Response status is 200
   - expect: Response body has 'ok: true'
   - expect: Response contains 'triggeredFlows' count and 'runs' array

#### 7.2. webhook to unknown path returns 404 or appropriate error

**File:** `tests/credentials/webhook-ingestion.spec.ts`

**Steps:**

1. Send a POST request to http://localhost:3000/flowlib/webhooks/credentials/nonexistent-path-abc123 with a JSON body
   - expect: Response status is 404 or 400
   - expect: Response body indicates credential not found

#### 7.3. webhook rate limiting returns 429 after rapid-fire requests

**File:** `tests/credentials/webhook-ingestion.spec.ts`

**Steps:**

1. Get the webhook path for 'Linear OAuth2' credential
   - expect: webhookPath is retrieved

2. Rapidly send 50+ POST requests to the webhook URL in a tight loop
   - expect: Initial requests succeed with 200 status
   - expect: Eventually a response returns 429 (Too Many Requests) with a 'Rate limit exceeded' message

### 8. Credential Usage in Flow Execution

**Seed:** `tests/seed.spec.ts`

#### 8.1. credential selector appears on nodes that require credentials

**File:** `tests/credentials/flow-integration.spec.ts`

**Steps:**

1. Navigate to a flow that contains a node requiring credentials (e.g. 'Triggered Linear Agent')
   - expect: The flow editor canvas loads with nodes visible

2. Double-click on an agent node or a node that has a credential parameter
   - expect: The config panel opens
   - expect: A credential selector dropdown or field is visible in the parameters section

#### 8.2. credentials page is accessible from the dashboard sidebar

**File:** `tests/credentials/flow-integration.spec.ts`

**Steps:**

1. Navigate to /flowlib (dashboard)
   - expect: Dashboard loads with sidebar visible

2. Click the Credentials link in the sidebar navigation (the key icon link at /flowlib/credentials)
   - expect: The page navigates to /flowlib/credentials
   - expect: The Credentials heading and list are visible

3. Click the 'Credentials' button in the dashboard header area
   - expect: Navigates to /flowlib/credentials

### 9. Credential Edge Cases & Error Handling

**Seed:** `tests/seed.spec.ts`

#### 9.1. empty state shows create prompt when no credentials exist

**File:** `tests/credentials/edge-cases.spec.ts`

**Steps:**

1. Delete all credentials via the API (DELETE /flowlib/credentials/:id for each)
   - expect: All deletions succeed

2. Navigate to /flowlib/credentials
   - expect: Empty state is shown: 'No credentials yet' heading
   - expect: 'Add API keys, connect OAuth providers, or configure database credentials...' text
   - expect: A 'Create Credential' button is visible in the empty state

3. Click the 'Create Credential' button in the empty state
   - expect: Create dialog opens

#### 9.2. duplicate credential names are allowed

**File:** `tests/credentials/edge-cases.spec.ts`

**Steps:**

1. Create a credential named 'Duplicate Test'
   - expect: Credential is created successfully

2. Create another credential with the same name 'Duplicate Test'
   - expect: The second credential is also created successfully
   - expect: Both appear in the list (names are not unique)

#### 9.3. credential config secrets are masked in password fields

**File:** `tests/credentials/edge-cases.spec.ts`

**Steps:**

1. Navigate to /flowlib/credentials, open a bearer credential's detail, click 'Edit' tab
   - expect: The Token field is type='password' (input is masked)
   - expect: The placeholder says 'Enter bearer token' or shows dots

2. Open the detail for an API Key credential (if exists), click 'Edit' tab
   - expect: The API Key field is type='password'
