const inputCredit = {
	usuario: "test 17777", // ya lo tengo
	numero_credito_sifco: "43545321", // ya lo tengo
	capital: 50108.18, // ya lo tengo
	porcentaje_interes: 1.5, // ya lo tengo
	seguro_10_cuotas: 260.93, // No lo mando del front
	gps: 0, // tampoco lo tengo
	observaciones: "testtttttttt", // ya se manda uno por default
	no_poliza: "", // !esto no esta definido en cartera
	como_se_entero: "", // !no esta definido en cartera
	asesor: "", // esto ya deberia de tenerlo en front pero no lo mando
	plazo: 60, // ya lo tengo
	cuota: 2006.2, // ya lo tengo
	membresias_pago: 413.25, // ya lo tengo
	categoria: "CV Vehículo nuevo", // esto es una categoria no esta
	nit: "18440312", // no lo tengo pero ya deberia de estar
	royalti: 56256, // no lo tengo
	porcentaje_royalti: 4, // no lo tengo
	otros: 1002.52, //mmmm esto es opcional
	inversionistas: [
		/// aqui nada tengo
		{
			inversionista_id: 13,
			porcentaje_participacion: 0,
			cuota_inversionista: 1341.63,
			monto_aportado: 25108.18,
			porcentaje_cash_in: 20,
			porcentaje_inversion: 80,
		},
		{
			inversionista_id: 9,
			porcentaje_participacion: 0,
			cuota_inversionista: 664.57,
			monto_aportado: 25000,
			porcentaje_cash_in: 20,
			porcentaje_inversion: 80,
		},
	],
};
