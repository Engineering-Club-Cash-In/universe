import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { authClient } from "@/lib/auth-client";
import { useNavigate } from "@tanstack/react-router";
import { Button } from "./ui/button";
import { Skeleton } from "./ui/skeleton";
import { Link } from "@tanstack/react-router";
import { orpc } from "@/utils/orpc";
import { useQuery } from "@tanstack/react-query";

export default function UserMenu() {
  const navigate = useNavigate();
  const { data: session, isPending } = authClient.useSession();
  const userProfile = useQuery({
    ...orpc.getUserProfile.queryOptions(),
    enabled: !!session,
  });

  if (isPending) {
    return <Skeleton className="h-9 w-24" />;
  }

  if (!session) {
    return (
      <Button variant="outline" asChild>
        <Link to="/login">Sign In</Link>
      </Button>
    );
  }

  const userRole = userProfile.data?.role;
  const roleColor = userRole === 'admin' ? 'text-red-600' : 'text-blue-600';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline">
          <span>{session.user.name}</span>
          {userRole && (
            <span className={`ml-2 text-xs ${roleColor}`}>
              ({userRole})
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="bg-card">
        <DropdownMenuLabel>My Account</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem>{session.user.email}</DropdownMenuItem>
        {userRole && (
          <DropdownMenuItem>
            <span className={roleColor}>Role: {userRole}</span>
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Button
            variant="destructive"
            className="w-full"
            onClick={() => {
              authClient.signOut({
                fetchOptions: {
                  onSuccess: () => {
                    navigate({
                      to: "/",
                    });
                  },
                },
              });
            }}
          >
            Sign Out
          </Button>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
