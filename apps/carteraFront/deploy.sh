podman build -t cartera-front .

podman tag cartera-front:latest public.ecr.aws/a6w8m2u2/cartera-front:latest

podman push public.ecr.aws/a6w8m2u2/cartera-front:latest