# S3 Storage Integration

NetFlow allows organizations to connect to an external AWS S3 (or compatible) storage bucket for managing files. When enabled, this overrides the default internal storage for your workspace.

## Accessing S3 Storage

If enabled by a Platform Super Admin (`s3Enabled`), you can access the S3 Storage dashboard by navigating to **Documents Management System &rarr; S3 Storage** in the Org Admin sidebar.

## Managing Files

The S3 Storage dashboard (`/s3-storage`) provides a full file browser interface directly connected to your configured bucket.

- **Browse & Navigate**: Click on folders to navigate through the bucket's hierarchy.
- **Upload**: Upload new files directly into the current folder.
- **Delete**: Remove files from the bucket permanently.

## Storage Quotas & Limits

Files stored in an external S3 bucket do not typically count against your internal NetFlow storage quota. However, your organization is responsible for the S3 bucket costs and AWS storage limits. 

If connection errors occur (e.g., incorrect credentials or bucket policies), the dashboard will display specific S3 connection errors to help you troubleshoot.
