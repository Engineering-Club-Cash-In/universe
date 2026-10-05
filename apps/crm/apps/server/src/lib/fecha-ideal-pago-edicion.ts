export function puedeCambiarDiaPago(closurePercentage: number): boolean {
	return closurePercentage < 80;
}

export function puedeAsignarInversionistas(closurePercentage: number): boolean {
	return closurePercentage === 50;
}

export function requiereCongelarEtapaParaCambioDia(
	cambioDia: boolean,
	cambioIntencion: boolean,
	cambioLead: boolean,
): boolean {
	return cambioDia || cambioIntencion || cambioLead;
}
