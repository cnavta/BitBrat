# Request Log – sprint-170-fix-undeclared-backend-services

- **2025-12-25 12:25**: Initial issue reported: Terraform errors in `backendServiceNames` output.
- **Interpretation**: `google_compute_backend_service` is being used for regional resources that should be `google_compute_region_backend_service`.
