# Instrucciones para crear PRs

## Configuración de repositorio

Este repo tiene dos remotes:
- `origin`: Fork personal (`lraldaatcci/universe`)
- `upstream`: Repo principal (`Engineering-Club-Cash-In/universe`)

## Crear un PR a develop

### Opción 1: Branch existe en upstream (recomendado)

Si tu branch existe directamente en `upstream` (como `lralda`, `drodriguez`, etc.):

```bash
gh pr create --repo Engineering-Club-Cash-In/universe --base develop --head NOMBRE_BRANCH --title "titulo" --body "descripcion"
```

Ejemplo:
```bash
gh pr create --repo Engineering-Club-Cash-In/universe --base develop --head lralda --title "feat: mi feature" --body "## Summary
- Cambio 1
- Cambio 2

## Test plan
- [ ] Test 1
- [ ] Test 2"
```

### Opción 2: Branch solo existe en tu fork

Si tu branch solo existe en tu fork personal:

```bash
# Primero asegúrate de que el branch está pushed a tu fork
git push origin mi-branch

# Luego crea el PR especificando el fork
gh pr create --repo Engineering-Club-Cash-In/universe --base develop --head lraldaatcci:mi-branch --title "titulo" --body "descripcion"
```

## Verificar antes de crear PR

```bash
# Ver commits que se incluirán
git log upstream/develop..HEAD --oneline

# Ver archivos modificados
git diff upstream/develop...HEAD --stat

# Verificar que el branch está pushed
git fetch origin && git log origin/TU_BRANCH..HEAD --oneline
```

## Errores comunes

### "No commits between X and Y"
- El branch no está pushed al remote correcto
- Estás usando el formato incorrecto (fork vs upstream)

### "Head sha can't be blank"
- El branch no existe en el remote especificado
- Sincroniza con `git fetch upstream && git fetch origin`

## Template de PR

```bash
gh pr create --repo Engineering-Club-Cash-In/universe --base develop --head BRANCH --title "tipo(scope): descripción" --body "$(cat <<'EOF'
## Summary
- Cambio 1
- Cambio 2

## Test plan
- [ ] Verificar X
- [ ] Verificar Y

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
