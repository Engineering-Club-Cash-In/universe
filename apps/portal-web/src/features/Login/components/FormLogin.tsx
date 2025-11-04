import { Input, ButtonIcon, CheckBox, Button, Link } from "@components/ui";
import { IconGoogle } from "@components/icons";
import { useLogin } from "../hook/useLogin";

export const FormLogin = () => {
  const {
    formData,
    handleEmailChange,
    handlePasswordChange,
    handleRememberMeChange,
    handleSubmit,
    handleGoogleLogin,
    isLoading,
    error,
  } = useLogin();

  return (
    <div className="w-full flex justify-center mb-20 mt-16 items-center">
      <div className="w-[500px] flex flex-col text-center">
        <h2 className="text-header-2">Inicia sesión</h2>
        <form className="w-full mt-10 flex flex-col gap-6" onSubmit={handleSubmit}>
          {error && (
            <div className="p-3 bg-red-500/10 border border-red-500 rounded-lg text-red-500 text-sm">
              {error.message}
            </div>
          )}
          <Input
            value={formData.email}
            onChange={handleEmailChange}
            placeholder="Correo electrónico"
            type="email"
          />
          <Input
            value={formData.password}
            onChange={handlePasswordChange}
            placeholder="Contraseña"
            type="password"
          />
          <ButtonIcon 
            icon={<IconGoogle />} 
            onClick={handleGoogleLogin} 
            variant="lg"
          >
            Google
          </ButtonIcon>
          <CheckBox
            checked={formData.rememberMe ?? false}
            onChange={handleRememberMeChange}
            label="Recordar usuario"
          />
          <div className="flex justify-center items-center mt-4 flex-col gap-8">
            <Button type="submit">
              {isLoading ? "Iniciando sesión..." : "Iniciar sesión"}
            </Button>
            <Link href="reset-password" underline>
              ¿Olvidaste tu contraseña?
            </Link>
            <div className="flex justify-center items-center flex-col">
              <span>¿No tienes una cuenta?</span>
              <Link href="register" underline>
                Regístrate
              </Link>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
