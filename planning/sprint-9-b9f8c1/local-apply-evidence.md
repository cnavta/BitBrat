# Local Apply Evidence — Network Stack (Dev)

Sprint: sprint-9-b9f8c1
Run date/time: <fill-in-UTC>
Operator: <name/email>
Project ID: <PROJECT>
Region: <REGION>
Env: dev

Command executed
```
npm run brat -- infra apply network --env=dev --project-id <PROJECT>
```

Terraform outputs (outputs.json)
- Path: infrastructure/cdktf/out/network/outputs.json
- Contents (paste JSON):
```
<paste here>
```

VPC describe
```
gcloud compute networks describe brat-vpc --project <PROJECT> --format yaml
<output>
```

Subnet describe
```
gcloud compute networks subnets describe brat-subnet-<REGION>-dev --project <PROJECT> --region <REGION> --format yaml
<output>
```

Cloud Router describe
```
gcloud compute routers describe brat-router-<REGION> --project <PROJECT> --region <REGION> --format yaml
<output>
```

Cloud NAT describe
```
gcloud compute routers nats describe brat-nat-<REGION> --router brat-router-<REGION> --project <PROJECT> --region <REGION> --format yaml
<output>
```

Firewall rules
```
gcloud compute firewall-rules list --filter="name~'allow-(internal|health-checks)'" --project <PROJECT> --format yaml
<output>
```

Notes & anomalies
- <add any deviations, errors, or follow-ups>
