podman build -f Dockerfile -t cartera-back ../..

podman tag cartera-back:latest public.ecr.aws/a6w8m2u2/cartera-back:latest

podman push public.ecr.aws/a6w8m2u2/cartera-back:latest