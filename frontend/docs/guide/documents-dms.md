# Documents Management System (DMS)

The Documents Management System (DMS) provides a secure, integrated file storage solution within your NetFlow workspace. It allows you to organize, preview, and manage files securely.

## Accessing the DMS

If enabled for your organization, administrators can access the DMS by navigating to **Documents Management System &rarr; DMS** in the Org Admin sidebar.

> [!NOTE]
> The DMS feature is controlled by a platform-level feature flag (`dmsEnabled`). If you do not see it in your sidebar, contact your Platform Super Admin or check your plan's limits.

## Key Features

- **Folder Organization**: Create folders to organize your documents logically.
- **Secure Uploads**: Upload files directly into the DMS. Files are securely stored and tied to your workspace.
- **Document Preview**: Preview supported document types (like PDFs and images) directly within the NetFlow interface without downloading them.
- **Workflow Integration**: Files uploaded during form submissions or workflow tasks can be routed to the DMS for long-term storage and compliance.

## Handling Quota Errors

Your DMS usage counts toward your organization's total storage quota.
- If you approach your storage limit, you will see a warning in the **DMS status** widget on the Org Admin dashboard.
- If you exceed your quota, new uploads will fail. You must delete older files or contact billing to upgrade your plan and increase your storage limit.

## "Open in DMS"

When viewing submitted forms or task approvals that contain file attachments, you may see an **"Open in DMS"** action. This allows administrators to quickly jump to the file's location within the DMS for auditing or downloading.
