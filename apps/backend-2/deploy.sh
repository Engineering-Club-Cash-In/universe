podman build -f Dockerfile -t backend ../..

podman tag backend:latest public.ecr.aws/a6w8m2u2/cci/backend:latest

podman push public.ecr.aws/a6w8m2u2/cci/backend:latest
