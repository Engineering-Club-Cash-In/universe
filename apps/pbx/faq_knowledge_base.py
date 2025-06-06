# faq_knowledge_base.py
"""
FAQ Knowledge Base for Ana - AI Contact Center Agent
Contains structured FAQ data with intents, trigger phrases, and Spanish answers
"""

import re
from typing import Dict, List, Tuple, Optional

# Company trust snippet to be used contextually
COMPANY_TRUST_SNIPPET = """
Somos una empresa con más de 7 años de experiencia en el sector financiero guatemalteco, 
regulada por la Superintendencia de Bancos. Hemos ayudado a miles de familias a cumplir sus sueños 
con préstamos seguros y transparentes.
"""

# FAQ Knowledge Base
FAQ_DATABASE = {
    "faq_loan_types": {
        "intent_name": "faq_loan_types",
        "trigger_phrases": [
            "qué tipos de préstamo tienen",
            "tipos de préstamos",
            "qué créditos dan",
            "explíquenme sus préstamos",
            "cómo son los créditos que dan",
            "qué préstamos ofrecen",
            "modalidades de préstamo",
            "clases de préstamos",
            "opciones de crédito",
            "préstamos disponibles",
            "tipos",
            "préstamos",
            "qué préstamos",
            "préstamo",
            "tipo de préstamo",
            "opciones",
            "modalidades",
            "tipos de prestamos tienen"
        ],
        "answer": """Ofrecemos varios tipos de préstamos para adaptarnos a tus necesidades:

Préstamos Personales para gastos personales, vacaciones, o emergencias.
Préstamos para Vivienda para compra, construcción o remodelación de tu hogar.
Préstamos Vehiculares para la compra de tu auto nuevo o usado.
Préstamos para Negocio para impulsar tu emprendimiento o empresa.
Préstamos de Consolidación para unificar tus deudas en una sola cuota.

Todos nuestros préstamos tienen condiciones flexibles y tasas competitivas.""",
        "include_trust_snippet": True
    },
    
    "faq_interest_rates": {
        "intent_name": "faq_interest_rates",
        "trigger_phrases": [
            "tasas de interés",
            "qué intereses cobran",
            "cuánto de interés",
            "porcentaje de interés",
            "tasa anual",
            "intereses",
            "cuánto cobran de interés",
            "tasa del préstamo",
            "interés mensual",
            "qué tasa manejan"
        ],
        "answer": """Nuestras tasas de interés son muy competitivas y varían según el tipo de préstamo:

Préstamos Personales desde 18% hasta 24% anual.
Préstamos Vehiculares desde 14% hasta 20% anual.
Préstamos de Vivienda desde 12% hasta 18% anual.
Préstamos para Negocio desde 16% hasta 22% anual.

La tasa exacta depende de tu perfil crediticio, monto solicitado y plazo. 
Sin sorpresas! Te daremos la tasa exacta antes de firmar cualquier documento.""",
        "include_trust_snippet": False
    },
    
    "faq_loan_amounts_max": {
        "intent_name": "faq_loan_amounts_max",
        "trigger_phrases": [
            "monto máximo",
            "máximo que dan",
            "límite máximo",
            "dinero máximo",
            "cantidad máxima",
            "máximo",
            "hasta cuánto prestan",
            "cuánto es lo máximo",
            "tope máximo"
        ],
        "answer": """Nuestros montos máximos son:

Préstamos Personales: hasta 150,000 quetzales
Préstamos Vehiculares: hasta 500,000 quetzales
Préstamos de Vivienda: hasta 1,200,000 quetzales
Préstamos para Negocio: hasta 300,000 quetzales

El monto final depende de tu capacidad de pago y perfil crediticio.""",
        "include_trust_snippet": False
    },

    "faq_loan_amounts_min": {
        "intent_name": "faq_loan_amounts_min",
        "trigger_phrases": [
            "monto mínimo",
            "mínimo que prestan",
            "desde cuánto prestan",
            "cuánto es lo mínimo",
            "cantidad mínima"
        ],
        "answer": """El monto mínimo para todos nuestros préstamos es de 5,000 quetzales.

Esto aplica para todos los tipos: personales, vehiculares, vivienda y negocio.""",
        "include_trust_snippet": False
    },

    "faq_loan_amounts_general": {
        "intent_name": "faq_loan_amounts_general",
        "trigger_phrases": [
            "cuánto puedo pedir prestado",
            "cuánto prestan",
            "límites de préstamo",
            "rangos de préstamo",
            "monto",
            "cuánto dinero",
            "qué cantidad"
        ],
        "answer": """Nuestros préstamos van desde 5,000 hasta 1,200,000 quetzales:

Mínimo: 5,000 quetzales (todos los tipos)
Máximo: 1,200,000 quetzales (préstamos de vivienda)

El monto exacto depende del tipo de préstamo que necesites y tu capacidad de pago.""",
        "include_trust_snippet": False
    },
    
    "faq_application_time": {
        "intent_name": "faq_application_time",
        "trigger_phrases": [
            "cuánto tiempo toma",
            "tiempo de aprobación",
            "cuándo me aprueban",
            "proceso de solicitud",
            "tiempo del préstamo",
            "cuánto demora",
            "rapidez del préstamo",
            "tiempo de respuesta",
            "cuándo entregan el dinero",
            "proceso rápido"
        ],
        "answer": """Nuestro proceso es rápido y eficiente:

Solicitud Inicial de solo 10 a 15 minutos conmigo ahora mismo.
Evaluación de 24 a 48 horas hábiles para la respuesta.
Desembolso una vez aprobado, el dinero en tu cuenta en 1 a 2 días hábiles.

Proceso completo normalmente de 3 a 5 días hábiles desde la solicitud hasta tener el dinero.

Somos una de las instituciones más rápidas del mercado guatemalteco.""",
        "include_trust_snippet": False
    },
    
    "faq_company_registration": {
        "intent_name": "faq_company_registration",
        "trigger_phrases": [
            "empresa registrada",
            "empresa legal",
            "regulados por",
            "supervisados",
            "empresa confiable",
            "licencias",
            "permisos",
            "registro de la empresa",
            "empresa autorizada",
            "superintendencia"
        ],
        "answer": """Por supuesto! Somos una empresa 100% legal y confiable:

Registrados en el Registro Mercantil de Guatemala.
Supervisados por la Superintendencia de Bancos SIB.
Licencia vigente para operar como institución financiera.
Miembro de la Asociación Bancaria de Guatemala.

Puedes verificar nuestro registro en la página oficial de la SIB con nuestro número de licencia.""",
        "include_trust_snippet": True
    },
    
    "faq_requirements": {
        "intent_name": "faq_requirements",
        "trigger_phrases": [
            "qué necesito para solicitar",
            "requisitos",
            "documentos necesarios",
            "qué documentos",
            "papeles para préstamo",
            "qué piden",
            "requisitos para préstamo",
            "documentación",
            "qué debo tener",
            "papelería"
        ],
        "answer": """Los requisitos básicos son sencillos:

Para Todos los Préstamos:
Ser mayor de 18 años.
DPI vigente.
Comprobante de ingresos de los últimos 3 meses.
Referencias personales y comerciales.

Adicionales según el tipo:
Para Vivienda necesitas escritura o promesa de compraventa.
Para Vehículo necesitas tarjeta de circulación, factura o avalúo.
Para Negocio necesitas estados financieros básicos.

No te preocupes! Te guío paso a paso con cada documento.""",
        "include_trust_snippet": False
    },
    
    "faq_payment_terms": {
        "intent_name": "faq_payment_terms",
        "trigger_phrases": [
            "plazos de pago",
            "cuánto tiempo para pagar",
            "meses para pagar",
            "términos de pago",
            "período de pago",
            "tiempo del préstamo",
            "cuotas",
            "pagos mensuales",
            "plazo máximo",
            "años para pagar"
        ],
        "answer": """Ofrecemos plazos flexibles según tus necesidades:

Préstamos Personales de 12 a 60 meses.
Préstamos Vehiculares de 12 a 84 meses, es decir 7 años.
Préstamos de Vivienda de 60 a 300 meses, es decir 25 años.
Préstamos para Negocio de 12 a 72 meses.

Pagos mensuales fijos, siempre sabrás cuánto pagas cada mes.
Puedes pagar anticipadamente sin penalización.""",
        "include_trust_snippet": False
    }
}

def find_faq_intent(user_text: str) -> Optional[Dict]:
    """
    Find matching FAQ intent based on user input using improved keyword matching.
    
    Args:
        user_text (str): User's transcribed text in Spanish
        
    Returns:
        Optional[Dict]: FAQ data if found, None if no match
    """
    if not user_text:
        return None
    
    user_text_lower = user_text.lower()
    
    # Remove common question words and punctuation for better matching
    clean_text = re.sub(r'[¿?¡!.,;:]', ' ', user_text_lower)
    clean_text = re.sub(r'\b(me|puedes|podrías|quisiera|quiero|necesito|dime|explica|explícame|péntame|contame|háblame)\b', ' ', clean_text)
    clean_text = re.sub(r'\s+', ' ', clean_text).strip()
    
    print(f"🔍 Searching FAQ for: '{user_text}' -> cleaned: '{clean_text}'")
    
    best_match = None
    highest_score = 0
    
    for faq_key, faq_data in FAQ_DATABASE.items():
        score = 0
        trigger_phrases = faq_data["trigger_phrases"]
        
        for phrase in trigger_phrases:
            phrase_lower = phrase.lower()
            
            # Exact phrase match gets highest score
            if phrase_lower in clean_text:
                score += 15
                print(f"  ✅ Exact match: '{phrase_lower}' in '{clean_text}' -> score: {score}")
            else:
                # Word-by-word matching for partial matches
                phrase_words = phrase_lower.split()
                matched_words = sum(1 for word in phrase_words if word in clean_text)
                if matched_words > 0:
                    partial_score = (matched_words / len(phrase_words)) * 8
                    score += partial_score
                    print(f"  🔸 Partial match: {matched_words}/{len(phrase_words)} words from '{phrase_lower}' -> +{partial_score:.1f}")
        
        if score > 0:
            print(f"  📊 {faq_key}: {score:.1f} points")
        
        if score > highest_score and score >= 8:  # Lower threshold for better matching
            highest_score = score
            best_match = faq_data
    
    if best_match:
        print(f"🎯 Best match: {best_match['intent_name']} with score {highest_score:.1f}")
    else:
        print(f"❌ No FAQ match found for: '{user_text}'")
    
    return best_match

def get_faq_response(faq_data: Dict) -> str:
    """
    Generate complete FAQ response including company trust snippet if needed.
    
    Args:
        faq_data (Dict): FAQ data dictionary
        
    Returns:
        str: Complete response text
    """
    response = faq_data["answer"]
    
    if faq_data.get("include_trust_snippet", False):
        response += f"\n\n{COMPANY_TRUST_SNIPPET}"
    
    return response

def get_transition_question() -> str:
    """Get the transition question to ask after FAQ response."""
    return "¿Eso aclara tu duda? ¿Te gustaría que te ayude a iniciar una solicitud de préstamo ahora?"

# Test function
def test_faq_matching():
    """Test the FAQ matching system with sample queries."""
    test_queries = [
        "¿Qué tipos de préstamos tienen?",
        "Me pueden decir las tasas de interés",
        "Cuánto puedo pedir prestado",
        "Son una empresa registrada?",
        "Qué documentos necesito"
    ]
    
    print("=== Testing FAQ Matching ===")
    for query in test_queries:
        match = find_faq_intent(query)
        if match:
            print(f"\nQuery: {query}")
            print(f"Intent: {match['intent_name']}")
            print(f"Answer: {match['answer'][:100]}...")
        else:
            print(f"\nQuery: {query} - No match found")

if __name__ == "__main__":
    test_faq_matching() 