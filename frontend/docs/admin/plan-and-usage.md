# Plan & Usage

The **Plan & Usage** page (`/billing`) allows administrators to monitor their organization's subscription tier and current resource consumption.

## Accessing Plan & Usage

Navigate to **SETTINGS &rarr; Plan & Usage** in the Org Admin sidebar.

## Usage Meters & Charts

The dashboard provides visual meters and charts tracking your current consumption against your plan limits:
- **Users**: Number of active users versus your total allowed seats.
- **Builders**: Number of users with builder (admin) roles capable of designing forms and workflows.
- **Forms & Workflows**: Active templates published in your workspace.
- **Storage**: Total data stored across form attachments and DMS.

## License Status & Read-Only Mode

If your workspace license expires or is suspended:
- A global **LicenceBanner** will be displayed across the workspace.
- The platform automatically enters **Read-only mode**. 
- Users can log in and view historical data or past tasks, but no new workflows can be triggered, and form submissions are disabled.

## Quota Warnings

As you approach your plan limits (typically at 80%, 90%, and 100%), the system will surface quota warnings.
- **80% - 90%**: Yellow warnings advising you to clean up unused data or consider an upgrade.
- **100% (Limit Exceeded)**: Red alerts. The specific feature that hit the limit will be locked:
  - If **Users** limit is reached, you cannot invite new employees.
  - If **Builders** limit is reached, you must revoke builder roles from existing admins before assigning new ones.
  - If **Storage** limit is reached, file uploads and DMS operations will fail.
