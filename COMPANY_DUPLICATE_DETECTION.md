# Company Name Duplicate Detection Implementation

## Overview
Added company-name-based duplicate detection to BidTracker. Job applications are now automatically marked as duplicated if another application with the same normalized company name already exists in the workspace.

## Normalization Rule
Company names are normalized for duplicate detection using this exact rule:

1. Keep only: `a-z`, `A-Z`, `0-9`
2. Remove ALL other characters (spaces, punctuation, hyphens, underscores, periods, apostrophes, ampersands, parentheses, slashes, etc.)
3. Convert to lowercase
4. Empty/null names do NOT match each other

### Examples
```
"ABC Inc."           → "abcinc"
"ABC, Inc"           → "abcinc"
"ABC-INC"            → "abcinc"
"abc inc"            → "abcinc"
"ABC & Inc."         → "abcinc"
"ABC_Inc"            → "abcinc"
""                   → "" (does not match other empty names)
```

## Changes Made

### 1. Added Normalization Function
**File**: `backend/src/common/utils/url.util.ts`
- Added `normalizeCompanyName(raw: string): string` function
- Removes all non-alphanumeric characters and converts to lowercase
- Returns empty string for empty/null inputs

### 2. Database Schema Updates
**File**: `backend/prisma/schema.prisma`
- Added `normalized_company_name: String?` field to `JobApplication` model
- Added indexes:
  - `@@index([workspace_id, normalized_company_name])` — for workspace-scoped lookups
  - `@@index([normalized_company_name])` — for global lookups

**Migration**: `backend/prisma/migrations/20260830000000_add_normalized_company_name/`
- Creates the `normalized_company_name` column
- Creates necessary database indexes

### 3. Enhanced DuplicateService
**File**: `backend/src/applications/duplicate.service.ts`

**Key Changes**:
- Updated `findExisting()` to accept optional company names array and return a third map (`byCompanyName`)
- Updated `classifyBatch()` to accept optional company names and check for company name duplicates
- Enhanced return interfaces:
  - `ExistingRef` now includes `company_name`, `normalized_company_name`, and `normalized_url`
  - `DuplicateVerdict` now includes `company_name`, `normalized_company_name`, and `duplicate_type` ('url' or 'company_name')

**Duplicate Detection Logic**:
1. Check for existing URL duplicates (exact or normalized URL)
2. Check for within-batch URL duplicates
3. Check for existing company name duplicates (only if normalized name is non-empty)
4. Check for within-batch company name duplicates
5. Return verdict indicating type of duplicate if found

**Important**: Empty/null normalized company names are never considered duplicates of each other.

### 4. Updated ApplicationsService
**File**: `backend/src/applications/applications.service.ts`

**Changes**:
- **`update()` method**: When editing a row's company name, checks for duplicate company names
  - If a duplicate is found and user is admin, row is marked as "Duplicated"
  - If user is not admin, edit is rejected with error message
  - Updates both `company_name` and `normalized_company_name` fields
  
- **`createFromUrls()` method**: Enhanced to include normalized company names
  - Enrichment extracts company names from URLs
  - Normalizes and stores in `normalized_company_name` field

### 5. Updated ImportService
**File**: `backend/src/import/import.service.ts`

**Changes**:
- Import process now passes company names to `classifyBatch()`
- Automatically calculates and stores normalized company names in import records
- Company name duplicates are detected during the import process
- Rows flagged as duplicates by company name are marked with `application_status: 'Duplicated'`

## Scope
- **Workspace-scoped by default**: Company name duplicates are detected within each workspace
- **Global scope option**: If `DUPLICATE_SCOPE=global` environment variable is set, company name duplicates are checked across the entire system (same as URL detection)

## Entry Points for Duplicate Detection

### 1. Manual URL Paste (`/applications/urls`)
- Company names extracted from URLs via metadata enrichment
- Normalized company names stored in database

### 2. File Import (CSV/XLSX)
- Company names read from file or extracted from URLs
- Normalized company names checked against existing rows
- Duplicate rows automatically marked with `application_status: 'Duplicated'`

### 3. Manual Edit (`PATCH /applications/:id`)
- Editing company name triggers duplicate check
- Non-admin users cannot edit a row into a company name duplicate
- Admin users can override and mark row as duplicated

### 4. Any API endpoint that creates/updates applications
- All write paths automatically include company name duplicate detection

## Empty Company Names
- Empty, null, or whitespace-only company names do NOT trigger duplicate detection
- Multiple rows with empty company names can coexist without conflict
- This allows legitimate scenarios (e.g., unknown company sources)

## Performance Considerations

### Database Optimization
- Uses database indexes for efficient lookups: `(workspace_id, normalized_company_name)` and `(normalized_company_name)`
- Chunked queries (400 rows at a time) to stay within SQLite parameter limits
- No need to load entire application table into memory

### Duplicate Check Timing
- **First check** (existing duplicates): One batched database query
- **Second check** (within-batch duplicates): In-memory Set tracking during loop
- Total time complexity: O(n) where n = number of records being processed

## Testing the Feature

### Manual Testing Steps
1. Create an application with company name "Microsoft"
2. Try to create another application with name "MICROSOFT" — should be marked as duplicated
3. Try "Microsoft Inc." — should be marked as duplicated (normalizes to same string)
4. Try "Different Company" — should NOT be duplicated
5. Import a CSV with company names — verify duplicates are detected
6. Edit an existing row's company name to match another row — verify error or duplicate marking

### Expected Behavior
- Applications with the same normalized company name are marked as `application_status: 'Duplicated'`
- Duplicates affect payment (same as URL duplicates)
- Admin users can override duplicate detection
- Regular users cannot edit rows into duplicates

## Migration
The database migration must be run before deploying:
```bash
npm run prisma:migrate
# or
npm run prisma:deploy
```

This will:
- Add `normalized_company_name` column to `job_applications` table
- Create necessary indexes
- Existing rows will have NULL in this column until manually re-processed or re-imported
