import { NavBar } from "@components/ui";
import { InfoPerson } from "./InfoPerson";
import { ContainerMenu } from "../components/ContainerMenu";
import { useProfile } from "../hooks/useProfile";

export const Profile = () => {
  const { user, isLoading } = useProfile();

  if (isLoading) {
    return (
      <div>
        <div className="w-full mt-4 ">
          <NavBar />
          <div className="max-w-4xl mx-auto mt-16 mb-20">
            <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl p-8">
              <div className="flex justify-center items-center py-12">
                <div className="inline-block animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-white"></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="w-full mt-4">
        <NavBar />
        <ContainerMenu>
          {/* Header - Mi Perfil */}
          <div className="mb-12">
            <h1 className="text-2xl font-bold lg:text-header-2 mb-6">
              Mi Perfil
            </h1>

            <div className="flex items-center gap-6">
              {/* Imagen de perfil */}
              <div className="w-24 h-24 rounded-full bg-primary/20 flex items-center justify-center text-primary text-3xl font-bold">
                {user?.cachedImage || user?.image ? (
                  <img
                    src={user.cachedImage || user.image}
                    alt="Imagen de perfil"
                    className="w-full h-full object-cover rounded-full"
                  />
                ) : (
                  user?.name?.charAt(0).toUpperCase() ||
                  user?.email.charAt(0).toUpperCase()
                )}
              </div>

              {/* Información básica */}
              <div>
                <p className="text-body lg:text-header-4 mb-2">
                  {user?.name || "Usuario"}
                </p>
                <p className="text-gray text-lg">{user?.email}</p>
              </div>
            </div>
          </div>
          {user && (
            <div className="space-y-6">
              <InfoPerson
                userId={user.id}
                userName={user.name}
                userEmail={user.email}
                userImage={user.image}
              />
            </div>
          )}
        </ContainerMenu>
      </div>
    </div>
  );
};
