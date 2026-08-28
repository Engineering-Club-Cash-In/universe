import Big from "big.js";
import type { FactorPonderadoPorMontoInput } from "./splitInteresPci";

const stringAmount: FactorPonderadoPorMontoInput = {
	montoAportado: "100.01",
	factor: new Big("0.8"),
};
const bigAmount: FactorPonderadoPorMontoInput = {
	montoAportado: new Big("100.01"),
	factor: new Big("0.8"),
};

const numberAmount: FactorPonderadoPorMontoInput = {
	// @ts-expect-error shared money API must not accept IEEE-754 numbers
	montoAportado: 100.01,
	factor: new Big("0.8"),
};

void stringAmount;
void bigAmount;
void numberAmount;
