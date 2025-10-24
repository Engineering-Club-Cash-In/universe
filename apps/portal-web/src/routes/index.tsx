import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: Index,
});

function Index() {
  return (
    <div className="p-6 flex flex-col gap-4 ">
      <h1 className="text-header-1">CashIn</h1>
      <h2 className="text-header-2">Título 2</h2>
      <h3 className="text-header-3">Título 3</h3>
      <p className="text-header-4">Título 4</p>
      <p className="text-header-body">Texto do corpo do cabeçalho</p>
      <div className="text-body text-secondary">
        Cuerpo de texto "Lorem ipsum dolor sit amet, consectetur adipiscing
        elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.
        Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi
        ut aliquip ex ea commodo consequat. Duis aute irure dolor in
        reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla
        pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa
        qui officia deserunt mollit anim id est laborum."
      </div>
    </div>
  );
}
