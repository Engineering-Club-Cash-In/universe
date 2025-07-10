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
import { Badge } from "./ui/badge";
import { Shield, User } from "lucide-react";

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
  const getRoleBadgeColor = (role: string) => {
    return role === 'admin' ? 'bg-red-100 text-red-800' : 'bg-blue-100 text-blue-800';
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="flex items-center space-x-2">
          <span>{session.user.name}</span>
          {userRole && (
            <Badge className={getRoleBadgeColor(userRole)} variant="outline">
              {userRole === 'admin' ? (
                <><Shield className="w-3 h-3 mr-1" /> Admin</>
              ) : (
                <><User className="w-3 h-3 mr-1" /> Sales</>
              )}
            </Badge>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="bg-card">
        <DropdownMenuLabel>My Account</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem>{session.user.email}</DropdownMenuItem>
        {userRole && (
          <DropdownMenuItem>
            <Badge className={getRoleBadgeColor(userRole)} variant="outline">
              {userRole === 'admin' ? (
                <><Shield className="w-3 h-3 mr-1" /> Admin</>
              ) : (
                <><User className="w-3 h-3 mr-1" /> Sales</>
              )}
            </Badge>
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
