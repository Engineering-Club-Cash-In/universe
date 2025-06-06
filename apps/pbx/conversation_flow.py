# conversation_flow.py
"""
Conversation Flow Handler for Ana - AI Contact Center Agent
Manages state-based conversation flow, validation, and responses
"""

import re
from typing import Dict, Tuple, Optional, Any
from session_manager import (
    ConversationState, session_manager, get_current_state, 
    update_state, get_retry_count
)

class ConversationFlowHandler:
    """Handles conversation flow and state management"""
    
    def __init__(self):
        self.max_retries = 2
    
    def process_user_input(self, session_id: str, user_input: str) -> Dict[str, Any]:
        """
        Process user input based on current conversation state
        
        Returns:
            Dict with keys: 'response', 'next_state', 'success', 'data_collected'
        """
        current_state = get_current_state(session_id)
        
        # Handle different states
        if current_state == ConversationState.AWAITING_TRANSITION_RESPONSE:
            return self._handle_transition_response(session_id, user_input)
        elif current_state == ConversationState.STATE_ASK_ELIGIBILITY_PERMISSION:
            return self._handle_eligibility_permission(session_id, user_input)
        elif current_state == ConversationState.STATE_ASK_MINIMUM_AGE:
            return self._handle_age_validation(session_id, user_input)
        elif current_state == ConversationState.STATE_ASK_RESIDENCY:
            return self._handle_residency_validation(session_id, user_input)
        elif current_state == ConversationState.STATE_ASK_MINIMUM_INCOME:
            return self._handle_income_validation(session_id, user_input)
        elif current_state == ConversationState.STATE_HANDLE_INITIAL_QUALIFICATION_RESULT:
            return self._handle_qualification_result(session_id)
        elif current_state == ConversationState.STATE_ASK_FULL_NAME:
            return self._handle_full_name_validation(session_id, user_input)
        elif current_state == ConversationState.STATE_ASK_DPI:
            return self._handle_dpi_validation(session_id, user_input)
        elif current_state == ConversationState.STATE_ASK_DOB:
            return self._handle_dob_validation(session_id, user_input)
        elif current_state == ConversationState.STATE_ASK_ADDRESS:
            return self._handle_address_validation(session_id, user_input)
        elif current_state == ConversationState.STATE_ASK_PHONE:
            return self._handle_phone_validation(session_id, user_input)
        elif current_state == ConversationState.STATE_ASK_EMAIL:
            return self._handle_email_validation(session_id, user_input)
        elif current_state == ConversationState.STATE_ASK_EMPLOYMENT_STATUS:
            return self._handle_employment_status_validation(session_id, user_input)
        elif current_state == ConversationState.STATE_ASK_EMPLOYMENT_DETAILS:
            return self._handle_employment_details(session_id, user_input)
        elif current_state == ConversationState.STATE_ASK_LOAN_AMOUNT:
            return self._handle_loan_amount_validation(session_id, user_input)
        elif current_state == ConversationState.STATE_ASK_LOAN_PURPOSE:
            return self._handle_loan_purpose_validation(session_id, user_input)
        elif current_state == ConversationState.STATE_ASK_CONSENT_DISCLOSURES:
            return self._handle_consent_validation(session_id, user_input)
        elif current_state == ConversationState.STATE_PROVIDE_APPLICATION_SUMMARY:
            return self._provide_application_summary(session_id)
        else:
            return {
                'response': 'Lo siento, hay un error en el sistema. ¿Podrías repetir tu solicitud?',
                'next_state': ConversationState.GENERAL_CHAT,
                'success': False,
                'data_collected': None
            }
    
    def get_initial_question(self, state: ConversationState) -> str:
        """Get the initial question for a given state"""
        questions = {
            ConversationState.STATE_ASK_ELIGIBILITY_PERMISSION: 
                "¡Excelente! Para comenzar con tu solicitud de préstamo, necesito hacerte unas preguntas rápidas para verificar tu elegibilidad. ¿Está bien que comencemos?",
            
            ConversationState.STATE_ASK_MINIMUM_AGE:
                "Perfecto, comencemos. Primera pregunta: ¿Tienes 18 años o más?",
            
            ConversationState.STATE_ASK_RESIDENCY:
                "Entendido. ¿Resides actualmente en Guatemala?",
            
            ConversationState.STATE_ASK_MINIMUM_INCOME:
                "Muy bien. ¿Tienes ingresos mensuales de al menos 3,000 quetzales?",
            
            ConversationState.STATE_ASK_FULL_NAME:
                "¿Cuál es tu nombre completo?",
            
            ConversationState.STATE_ASK_DPI:
                "Gracias. ¿Cuál es tu número de DPI?",
            
            ConversationState.STATE_ASK_DOB:
                "Perfecto. ¿Cuál es tu fecha de nacimiento? Por favor dímela en formato día, mes, año.",
            
            ConversationState.STATE_ASK_ADDRESS:
                "Muy bien. ¿Cuál es tu dirección completa de residencia?",
            
            ConversationState.STATE_ASK_PHONE:
                "Gracias. ¿Cuál es tu número de teléfono?",
            
            ConversationState.STATE_ASK_EMAIL:
                "Perfecto. ¿Cuál es tu dirección de correo electrónico?",
            
            ConversationState.STATE_ASK_EMPLOYMENT_STATUS:
                "Muy bien. ¿Cuál es tu situación laboral actual? ¿Estás empleado, eres trabajador independiente, estudiante, o desempleado?",
            
            ConversationState.STATE_ASK_LOAN_AMOUNT:
                "Perfecto. ¿Qué monto de préstamo necesitas? Recuerda que nuestros préstamos van desde 5,000 hasta 1,200,000 quetzales según el tipo.",
            
            ConversationState.STATE_ASK_LOAN_PURPOSE:
                "Entendido. ¿Para qué necesitas este préstamo? Por ejemplo: compra de vivienda, vehículo, gastos personales, negocio, etc.",
            
            ConversationState.STATE_ASK_CONSENT_DISCLOSURES:
                "Casi terminamos. Para procesar tu solicitud necesito tu consentimiento para verificar tu información crediticia y contactarte sobre tu aplicación. ¿Aceptas estos términos?"
        }
        
        return questions.get(state, "¿En qué puedo ayudarte?")
    
    def _handle_transition_response(self, session_id: str, user_input: str) -> Dict[str, Any]:
        """Handle response to transition question after FAQ"""
        if self._is_affirmative(user_input):
            session_manager.start_application_flow(session_id)
            return {
                'response': self.get_initial_question(ConversationState.STATE_ASK_ELIGIBILITY_PERMISSION),
                'next_state': ConversationState.STATE_ASK_ELIGIBILITY_PERMISSION,
                'success': True,
                'data_collected': None
            }
        elif self._is_negative(user_input):
            return {
                'response': "Entiendo. ¿Hay algo más en lo que te pueda ayudar hoy?",
                'next_state': ConversationState.GENERAL_CHAT,
                'success': True,
                'data_collected': None
            }
        else:
            # Neither clearly affirmative nor negative - could be another question
            # Let the main logic handle this as a potential FAQ or other inquiry
            return {
                'response': "No entendí tu respuesta. ¿Te gustaría que te ayude a iniciar una solicitud de préstamo? Por favor responde 'sí' o 'no'.",
                'next_state': ConversationState.AWAITING_TRANSITION_RESPONSE,
                'success': False,
                'data_collected': None
            }
    
    def _handle_eligibility_permission(self, session_id: str, user_input: str) -> Dict[str, Any]:
        """Handle eligibility permission response"""
        if self._is_affirmative(user_input):
            return {
                'response': self.get_initial_question(ConversationState.STATE_ASK_MINIMUM_AGE),
                'next_state': ConversationState.STATE_ASK_MINIMUM_AGE,
                'success': True,
                'data_collected': None
            }
        else:
            return {
                'response': "Entiendo. Si cambias de opinión, estaré aquí para ayudarte. ¿Hay algo más en lo que te pueda ayudar?",
                'next_state': ConversationState.GENERAL_CHAT,
                'success': True,
                'data_collected': None
            }
    
    def _handle_age_validation(self, session_id: str, user_input: str) -> Dict[str, Any]:
        """Handle age validation"""
        is_valid, age_data = self._validate_age_response(user_input)
        
        if is_valid:
            session_manager.update_application_data(session_id, 'is_minimum_age', True)
            if age_data:
                session_manager.update_application_data(session_id, 'age', age_data)
            
            return {
                'response': self.get_initial_question(ConversationState.STATE_ASK_RESIDENCY),
                'next_state': ConversationState.STATE_ASK_RESIDENCY,
                'success': True,
                'data_collected': {'age': age_data}
            }
        else:
            retry_count = session_manager.increment_retry_count(session_id)
            if retry_count >= self.max_retries:
                session_manager.update_application_data(session_id, 'is_minimum_age', False)
                return {
                    'response': "Lo siento, pero nuestros préstamos requieren ser mayor de 18 años. Cuando cumplas la edad mínima, estaremos encantados de ayudarte. ¿Hay algo más en lo que te pueda ayudar?",
                    'next_state': ConversationState.GENERAL_CHAT,
                    'success': False,
                    'data_collected': None
                }
            else:
                return {
                    'response': "Disculpa, no entendí bien. ¿Podrías confirmar si tienes 18 años o más? Puedes responder 'sí' o 'no'.",
                    'next_state': ConversationState.STATE_ASK_MINIMUM_AGE,
                    'success': False,
                    'data_collected': None
                }
    
    def _handle_residency_validation(self, session_id: str, user_input: str) -> Dict[str, Any]:
        """Handle residency validation"""
        if self._is_affirmative(user_input):
            session_manager.update_application_data(session_id, 'is_guatemalan_resident', True)
            return {
                'response': self.get_initial_question(ConversationState.STATE_ASK_MINIMUM_INCOME),
                'next_state': ConversationState.STATE_ASK_MINIMUM_INCOME,
                'success': True,
                'data_collected': {'residency': True}
            }
        elif self._is_negative(user_input):
            session_manager.update_application_data(session_id, 'is_guatemalan_resident', False)
            return {
                'response': "Lo siento, actualmente solo ofrecemos préstamos a residentes de Guatemala. ¿Hay algo más en lo que te pueda ayudar?",
                'next_state': ConversationState.GENERAL_CHAT,
                'success': False,
                'data_collected': None
            }
        else:
            retry_count = session_manager.increment_retry_count(session_id)
            if retry_count >= self.max_retries:
                return {
                    'response': "No puedo continuar sin esta información. Te invito a contactarnos nuevamente cuando puedas proporcionar la información requerida. ¿Hay algo más en lo que te pueda ayudar?",
                    'next_state': ConversationState.GENERAL_CHAT,
                    'success': False,
                    'data_collected': None
                }
            else:
                return {
                    'response': "Disculpa, no entendí. ¿Resides actualmente en Guatemala? Por favor responde 'sí' o 'no'.",
                    'next_state': ConversationState.STATE_ASK_RESIDENCY,
                    'success': False,
                    'data_collected': None
                }
    
    def _handle_income_validation(self, session_id: str, user_input: str) -> Dict[str, Any]:
        """Handle income validation"""
        is_valid, income_data = self._validate_income_response(user_input)
        
        if is_valid:
            session_manager.update_application_data(session_id, 'has_minimum_income', True)
            if income_data:
                session_manager.update_application_data(session_id, 'monthly_income', income_data)
            
            return {
                'response': "Perfecto, cumples con los requisitos básicos.",
                'next_state': ConversationState.STATE_HANDLE_INITIAL_QUALIFICATION_RESULT,
                'success': True,
                'data_collected': {'income': income_data}
            }
        else:
            retry_count = session_manager.increment_retry_count(session_id)
            if retry_count >= self.max_retries:
                session_manager.update_application_data(session_id, 'has_minimum_income', False)
                return {
                    'response': "Entiendo. Lamentablemente, nuestros préstamos requieren ingresos mínimos de 3,000 quetzales mensuales. Te invitamos a aplicar nuevamente cuando tus ingresos aumenten. ¿Hay algo más en lo que te pueda ayudar?",
                    'next_state': ConversationState.GENERAL_CHAT,
                    'success': False,
                    'data_collected': None
                }
            else:
                return {
                    'response': "Disculpa, no entendí. ¿Tienes ingresos mensuales de al menos 3,000 quetzales? Puedes responder 'sí' o 'no'.",
                    'next_state': ConversationState.STATE_ASK_MINIMUM_INCOME,
                    'success': False,
                    'data_collected': None
                }
    
    def _handle_qualification_result(self, session_id: str) -> Dict[str, Any]:
        """Handle qualification result and proceed to data collection"""
        if session_manager.is_qualified(session_id):
            session_manager.update_application_data(session_id, 'qualified', True)
            return {
                'response': "¡Excelente! Calificas para nuestros préstamos. Ahora necesito recopilar algunos datos personales.",
                'next_state': ConversationState.STATE_ASK_FULL_NAME,
                'success': True,
                'data_collected': None
            }
        else:
            return {
                'response': "Lo siento, no cumples con los requisitos mínimos para nuestros préstamos en este momento. ¿Hay algo más en lo que te pueda ayudar?",
                'next_state': ConversationState.GENERAL_CHAT,
                'success': False,
                'data_collected': None
            }
    
    def _handle_full_name_validation(self, session_id: str, user_input: str) -> Dict[str, Any]:
        """Handle full name validation"""
        is_valid, name = self._validate_full_name(user_input)
        
        if is_valid:
            session_manager.update_application_data(session_id, 'full_name', name)
            return {
                'response': self.get_initial_question(ConversationState.STATE_ASK_DPI),
                'next_state': ConversationState.STATE_ASK_DPI,
                'success': True,
                'data_collected': {'full_name': name}
            }
        else:
            retry_count = session_manager.increment_retry_count(session_id)
            if retry_count >= self.max_retries:
                return {
                    'response': "No puedo continuar sin tu nombre completo. Te invito a contactarnos nuevamente. ¿Hay algo más en lo que te pueda ayudar?",
                    'next_state': ConversationState.GENERAL_CHAT,
                    'success': False,
                    'data_collected': None
                }
            else:
                return {
                    'response': "Disculpa, necesito tu nombre completo. Por favor proporciona tu nombre y apellidos completos.",
                    'next_state': ConversationState.STATE_ASK_FULL_NAME,
                    'success': False,
                    'data_collected': None
                }
    
    def _handle_dpi_validation(self, session_id: str, user_input: str) -> Dict[str, Any]:
        """Handle DPI validation"""
        is_valid, dpi = self._validate_dpi(user_input)
        
        if is_valid:
            session_manager.update_application_data(session_id, 'dpi', dpi)
            return {
                'response': self.get_initial_question(ConversationState.STATE_ASK_DOB),
                'next_state': ConversationState.STATE_ASK_DOB,
                'success': True,
                'data_collected': {'dpi': dpi}
            }
        else:
            retry_count = session_manager.increment_retry_count(session_id)
            if retry_count >= self.max_retries:
                return {
                    'response': "No puedo continuar sin un DPI válido. Te invito a contactarnos nuevamente con tu DPI. ¿Hay algo más en lo que te pueda ayudar?",
                    'next_state': ConversationState.GENERAL_CHAT,
                    'success': False,
                    'data_collected': None
                }
            else:
                return {
                    'response': "Disculpa, necesito un número de DPI válido. Debe ser un número de 13 dígitos. ¿Podrías repetirlo?",
                    'next_state': ConversationState.STATE_ASK_DPI,
                    'success': False,
                    'data_collected': None
                }
    
    def _handle_dob_validation(self, session_id: str, user_input: str) -> Dict[str, Any]:
        """Handle date of birth validation"""
        is_valid, dob = self._validate_date_of_birth(user_input)
        
        if is_valid:
            session_manager.update_application_data(session_id, 'date_of_birth', dob)
            return {
                'response': self.get_initial_question(ConversationState.STATE_ASK_ADDRESS),
                'next_state': ConversationState.STATE_ASK_ADDRESS,
                'success': True,
                'data_collected': {'date_of_birth': dob}
            }
        else:
            retry_count = session_manager.increment_retry_count(session_id)
            if retry_count >= self.max_retries:
                return {
                    'response': "No puedo continuar sin una fecha de nacimiento válida. Te invito a contactarnos nuevamente. ¿Hay algo más en lo que te pueda ayudar?",
                    'next_state': ConversationState.GENERAL_CHAT,
                    'success': False,
                    'data_collected': None
                }
            else:
                return {
                    'response': "Disculpa, no entendí la fecha. Por favor dime tu fecha de nacimiento en formato día, mes, año. Por ejemplo: 15 de marzo de 1990.",
                    'next_state': ConversationState.STATE_ASK_DOB,
                    'success': False,
                    'data_collected': None
                }
    
    def _handle_address_validation(self, session_id: str, user_input: str) -> Dict[str, Any]:
        """Handle address validation"""
        if len(user_input.strip()) >= 10:  # Basic validation
            session_manager.update_application_data(session_id, 'address', user_input.strip())
            return {
                'response': self.get_initial_question(ConversationState.STATE_ASK_PHONE),
                'next_state': ConversationState.STATE_ASK_PHONE,
                'success': True,
                'data_collected': {'address': user_input.strip()}
            }
        else:
            retry_count = session_manager.increment_retry_count(session_id)
            if retry_count >= self.max_retries:
                return {
                    'response': "No puedo continuar sin una dirección completa. Te invito a contactarnos nuevamente. ¿Hay algo más en lo que te pueda ayudar?",
                    'next_state': ConversationState.GENERAL_CHAT,
                    'success': False,
                    'data_collected': None
                }
            else:
                return {
                    'response': "Disculpa, necesito tu dirección completa. Por favor incluye zona, municipio o colonia.",
                    'next_state': ConversationState.STATE_ASK_ADDRESS,
                    'success': False,
                    'data_collected': None
                }
    
    def _handle_phone_validation(self, session_id: str, user_input: str) -> Dict[str, Any]:
        """Handle phone validation"""
        is_valid, phone = self._validate_phone(user_input)
        
        if is_valid:
            session_manager.update_application_data(session_id, 'phone', phone)
            return {
                'response': self.get_initial_question(ConversationState.STATE_ASK_EMAIL),
                'next_state': ConversationState.STATE_ASK_EMAIL,
                'success': True,
                'data_collected': {'phone': phone}
            }
        else:
            retry_count = session_manager.increment_retry_count(session_id)
            if retry_count >= self.max_retries:
                return {
                    'response': "No puedo continuar sin un número de teléfono válido. Te invito a contactarnos nuevamente. ¿Hay algo más en lo que te pueda ayudar?",
                    'next_state': ConversationState.GENERAL_CHAT,
                    'success': False,
                    'data_collected': None
                }
            else:
                return {
                    'response': "Disculpa, necesito un número de teléfono válido. Por ejemplo: 5555-1234 o 4455-6789.",
                    'next_state': ConversationState.STATE_ASK_PHONE,
                    'success': False,
                    'data_collected': None
                }
    
    def _handle_email_validation(self, session_id: str, user_input: str) -> Dict[str, Any]:
        """Handle email validation"""
        is_valid, email = self._validate_email(user_input)
        
        if is_valid:
            session_manager.update_application_data(session_id, 'email', email)
            return {
                'response': self.get_initial_question(ConversationState.STATE_ASK_EMPLOYMENT_STATUS),
                'next_state': ConversationState.STATE_ASK_EMPLOYMENT_STATUS,
                'success': True,
                'data_collected': {'email': email}
            }
        else:
            retry_count = session_manager.increment_retry_count(session_id)
            if retry_count >= self.max_retries:
                return {
                    'response': "No puedo continuar sin un correo electrónico válido. Te invito a contactarnos nuevamente. ¿Hay algo más en lo que te pueda ayudar?",
                    'next_state': ConversationState.GENERAL_CHAT,
                    'success': False,
                    'data_collected': None
                }
            else:
                # Check if it looks like a voice transcription attempt
                if any(word in user_input.lower() for word in ['arroba', 'punto', 'gmail', 'hotmail', 'yahoo']):
                    return {
                        'response': "Entiendo que estás dictando tu correo. Intenta decirlo claramente: 'mi correo es juan ARROBA gmail PUNTO com'. O puedes deletrearlo letra por letra.",
                        'next_state': ConversationState.STATE_ASK_EMAIL,
                        'success': False,
                        'data_collected': None
                    }
                else:
                    return {
                        'response': "Disculpa, necesito un correo electrónico válido. Puedes decir: 'mi correo es nombre ARROBA gmail PUNTO com' o deletrearlo.",
                        'next_state': ConversationState.STATE_ASK_EMAIL,
                        'success': False,
                        'data_collected': None
                    }
    
    def _handle_employment_status_validation(self, session_id: str, user_input: str) -> Dict[str, Any]:
        """Handle employment status validation"""
        employment_status = self._extract_employment_status(user_input)
        
        if employment_status:
            session_manager.update_application_data(session_id, 'employment_status', employment_status)
            
            if employment_status in ['employed', 'self_employed']:
                return {
                    'response': self._get_employment_details_question(employment_status),
                    'next_state': ConversationState.STATE_ASK_EMPLOYMENT_DETAILS,
                    'success': True,
                    'data_collected': {'employment_status': employment_status}
                }
            else:  # unemployed or student
                return {
                    'response': "Entiendo. Para continuar necesitarías tener un empleo o ingresos regulares. ¿Hay algo más en lo que te pueda ayudar?",
                    'next_state': ConversationState.GENERAL_CHAT,
                    'success': False,
                    'data_collected': None
                }
        else:
            retry_count = session_manager.increment_retry_count(session_id)
            if retry_count >= self.max_retries:
                return {
                    'response': "No puedo continuar sin conocer tu situación laboral. Te invito a contactarnos nuevamente. ¿Hay algo más en lo que te pueda ayudar?",
                    'next_state': ConversationState.GENERAL_CHAT,
                    'success': False,
                    'data_collected': None
                }
            else:
                return {
                    'response': "Disculpa, no entendí. ¿Estás empleado, eres trabajador independiente, estudiante, o desempleado?",
                    'next_state': ConversationState.STATE_ASK_EMPLOYMENT_STATUS,
                    'success': False,
                    'data_collected': None
                }
    
    def _handle_employment_details(self, session_id: str, user_input: str) -> Dict[str, Any]:
        """Handle employment details collection"""
        app_data = session_manager.get_application_data(session_id)
        
        if app_data.employment_status == 'employed':
            session_manager.update_application_data(session_id, 'company_name', user_input.strip())
            return {
                'response': self.get_initial_question(ConversationState.STATE_ASK_LOAN_AMOUNT),
                'next_state': ConversationState.STATE_ASK_LOAN_AMOUNT,
                'success': True,
                'data_collected': {'company_name': user_input.strip()}
            }
        else:  # self_employed
            session_manager.update_application_data(session_id, 'business_type', user_input.strip())
            return {
                'response': self.get_initial_question(ConversationState.STATE_ASK_LOAN_AMOUNT),
                'next_state': ConversationState.STATE_ASK_LOAN_AMOUNT,
                'success': True,
                'data_collected': {'business_type': user_input.strip()}
            }
    
    def _handle_loan_amount_validation(self, session_id: str, user_input: str) -> Dict[str, Any]:
        """Handle loan amount validation"""
        is_valid, amount = self._validate_loan_amount(user_input)
        
        if is_valid:
            session_manager.update_application_data(session_id, 'loan_amount', amount)
            return {
                'response': self.get_initial_question(ConversationState.STATE_ASK_LOAN_PURPOSE),
                'next_state': ConversationState.STATE_ASK_LOAN_PURPOSE,
                'success': True,
                'data_collected': {'loan_amount': amount}
            }
        else:
            retry_count = session_manager.increment_retry_count(session_id)
            if retry_count >= self.max_retries:
                return {
                    'response': "No puedo continuar sin un monto válido. Te invito a contactarnos nuevamente. ¿Hay algo más en lo que te pueda ayudar?",
                    'next_state': ConversationState.GENERAL_CHAT,
                    'success': False,
                    'data_collected': None
                }
            else:
                return {
                    'response': "Disculpa, no entendí el monto. Por favor indica una cantidad entre 5,000 y 1,200,000 quetzales. Por ejemplo: '50,000 quetzales' o '50 mil'.",
                    'next_state': ConversationState.STATE_ASK_LOAN_AMOUNT,
                    'success': False,
                    'data_collected': None
                }
    
    def _handle_loan_purpose_validation(self, session_id: str, user_input: str) -> Dict[str, Any]:
        """Handle loan purpose validation"""
        if len(user_input.strip()) >= 5:
            session_manager.update_application_data(session_id, 'loan_purpose', user_input.strip())
            return {
                'response': self.get_initial_question(ConversationState.STATE_ASK_CONSENT_DISCLOSURES),
                'next_state': ConversationState.STATE_ASK_CONSENT_DISCLOSURES,
                'success': True,
                'data_collected': {'loan_purpose': user_input.strip()}
            }
        else:
            retry_count = session_manager.increment_retry_count(session_id)
            if retry_count >= self.max_retries:
                return {
                    'response': "No puedo continuar sin conocer el propósito del préstamo. Te invito a contactarnos nuevamente. ¿Hay algo más en lo que te pueda ayudar?",
                    'next_state': ConversationState.GENERAL_CHAT,
                    'success': False,
                    'data_collected': None
                }
            else:
                return {
                    'response': "Disculpa, necesito saber para qué necesitas el préstamo. Por ejemplo: compra de casa, auto, negocio, gastos personales, etc.",
                    'next_state': ConversationState.STATE_ASK_LOAN_PURPOSE,
                    'success': False,
                    'data_collected': None
                }
    
    def _handle_consent_validation(self, session_id: str, user_input: str) -> Dict[str, Any]:
        """Handle consent validation"""
        if self._is_affirmative(user_input):
            session_manager.update_application_data(session_id, 'consent_given', True)
            return {
                'response': "¡Perfecto! Procesando tu solicitud...",
                'next_state': ConversationState.STATE_PROVIDE_APPLICATION_SUMMARY,
                'success': True,
                'data_collected': {'consent': True}
            }
        else:
            return {
                'response': "Entiendo. Sin tu consentimiento no podemos procesar la solicitud. Si cambias de opinión, estaremos aquí para ayudarte. ¿Hay algo más en lo que te pueda ayudar?",
                'next_state': ConversationState.GENERAL_CHAT,
                'success': False,
                'data_collected': None
            }
    
    def _provide_application_summary(self, session_id: str) -> Dict[str, Any]:
        """Provide application summary and next steps"""
        app_data = session_manager.get_application_data(session_id)
        
        summary = f"""Excelente! Tu solicitud ha sido registrada exitosamente.

Resumen de tu solicitud:
Número de referencia: {app_data.application_id}
Solicitante: {app_data.full_name}
Monto solicitado: {app_data.loan_amount:,.0f} quetzales
Propósito: {app_data.loan_purpose}

Próximos pasos:
Primero, nuestro equipo revisará tu solicitud en 24 a 48 horas.
Segundo, te contactaremos al {app_data.phone} para confirmar detalles.
Tercero, si es aprobada, coordinaremos la entrega de documentos.

Gracias por confiar en nosotros! Hay algo más en lo que te pueda ayudar hoy?"""
        
        return {
            'response': summary,
            'next_state': ConversationState.GENERAL_CHAT,
            'success': True,
            'data_collected': {'application_completed': True}
        }
    
    # Validation helper methods
    def _is_affirmative(self, text: str) -> bool:
        """Check if response is affirmative"""
        affirmative_words = [
            'sí', 'si', 'yes', 'claro', 'correcto', 'exacto', 'afirmativo', 'ok', 'está bien', 
            'acepto', 'de acuerdo', 'empecemos', 'comencemos', 'vamos', 'dale', 'perfecto',
            'genial', 'excelente', 'bueno', 'bien', 'seguro', 'por supuesto', 'desde luego',
            'comenzar', 'empezar', 'iniciar', 'continuar', 'proceder'
        ]
        text_lower = text.lower().strip()
        return any(word in text_lower for word in affirmative_words)
    
    def _is_negative(self, text: str) -> bool:
        """Check if response is negative"""
        negative_words = ['no', 'nop', 'nope', 'negativo', 'incorrecto', 'no acepto']
        text_lower = text.lower().strip()
        return any(word in text_lower for word in negative_words)
    
    def _validate_age_response(self, text: str) -> Tuple[bool, Optional[int]]:
        """Validate age response"""
        if self._is_affirmative(text):
            return True, None
        
        # Try to extract specific age
        age_match = re.search(r'(\d{1,2})', text)
        if age_match:
            age = int(age_match.group(1))
            if 18 <= age <= 100:
                return True, age
        
        return False, None
    
    def _validate_income_response(self, text: str) -> Tuple[bool, Optional[float]]:
        """Validate income response"""
        if self._is_affirmative(text):
            return True, None
        
        # Try to extract specific amount
        amount_match = re.search(r'(\d{1,2},?\d{0,3})', text.replace(',', ''))
        if amount_match:
            try:
                amount = float(amount_match.group(1).replace(',', ''))
                if amount >= 3000:
                    return True, amount
            except:
                pass
        
        return False, None
    
    def _validate_full_name(self, text: str) -> Tuple[bool, Optional[str]]:
        """Validate full name"""
        name = text.strip()
        if len(name) >= 5 and ' ' in name and all(c.isalpha() or c.isspace() for c in name):
            return True, name
        return False, None
    
    def _validate_dpi(self, text: str) -> Tuple[bool, Optional[str]]:
        """Validate DPI number"""
        dpi_match = re.search(r'(\d{13})', text.replace(' ', '').replace('-', ''))
        if dpi_match:
            return True, dpi_match.group(1)
        return False, None
    
    def _validate_date_of_birth(self, text: str) -> Tuple[bool, Optional[str]]:
        """Validate date of birth"""
        # Simple validation - look for day/month/year patterns
        date_patterns = [
            r'(\d{1,2})\s+de\s+(\w+)\s+de\s+(\d{4})',
            r'(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})',
            r'(\d{1,2})\s+(\d{1,2})\s+(\d{4})'
        ]
        
        for pattern in date_patterns:
            match = re.search(pattern, text, re.IGNORECASE)
            if match:
                return True, text.strip()
        
        return False, None
    
    def _validate_phone(self, text: str) -> Tuple[bool, Optional[str]]:
        """Validate phone number"""
        phone_match = re.search(r'(\d{4}[\-\s]?\d{4})', text.replace(' ', '').replace('-', ''))
        if phone_match:
            return True, phone_match.group(1)
        return False, None
    
    def _validate_email(self, text: str) -> Tuple[bool, Optional[str]]:
        """Validate email address, including voice transcriptions"""
        
        # First try standard email pattern
        email_pattern = r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b'
        match = re.search(email_pattern, text)
        if match:
            return True, match.group(0)
        
        # Handle voice transcriptions like "juan arroba gmail punto com"
        text_lower = text.lower().strip()
        
        # Convert voice patterns to email format
        voice_patterns = [
            # Pattern: "nombre arroba domain punto com"
            r'(\w+(?:\s+\w+)*)\s+arroba\s+(\w+(?:\s+\w+)*)\s+punto\s+(\w+)',
            # Pattern: "nombre @ domain . com" (partial transcription)  
            r'(\w+(?:\s+\w+)*)\s*@\s*(\w+(?:\s+\w+)*)\s*\.\s*(\w+)',
            # Pattern: "nombre en domain punto com"
            r'(\w+(?:\s+\w+)*)\s+en\s+(\w+(?:\s+\w+)*)\s+punto\s+(\w+)',
        ]
        
        for pattern in voice_patterns:
            match = re.search(pattern, text_lower)
            if match:
                # Extract parts and clean spaces
                name_part = match.group(1).replace(' ', '')
                domain_part = match.group(2).replace(' ', '')
                extension = match.group(3).replace(' ', '')
                
                # Common domain corrections
                domain_corrections = {
                    'gmail': 'gmail',
                    'g mail': 'gmail', 
                    'hotmail': 'hotmail',
                    'hot mail': 'hotmail',
                    'yahoo': 'yahoo',
                    'outlook': 'outlook',
                    'out look': 'outlook'
                }
                
                domain_clean = domain_corrections.get(domain_part, domain_part)
                
                # Extension corrections
                extension_corrections = {
                    'com': 'com',
                    'con': 'com',  # Common STT mistake
                    'es': 'es',
                    'net': 'net',
                    'org': 'org'
                }
                
                extension_clean = extension_corrections.get(extension, extension)
                
                # Construct email
                constructed_email = f"{name_part}@{domain_clean}.{extension_clean}"
                
                # Validate the constructed email
                if re.match(email_pattern, constructed_email):
                    return True, constructed_email
        
        # Try to extract any reasonable email-like pattern
        # Look for patterns like "nombre domain extension"
        words = text_lower.split()
        if len(words) >= 3:
            # Look for common email keywords
            email_keywords = ['arroba', '@', 'punto', '.', 'en', 'gmail', 'hotmail', 'yahoo', 'outlook']
            if any(keyword in text_lower for keyword in email_keywords):
                # This looks like an email attempt, provide helpful feedback
                return False, None
        
        return False, None
    
    def _extract_employment_status(self, text: str) -> Optional[str]:
        """Extract employment status from text"""
        text_lower = text.lower()
        
        if any(word in text_lower for word in ['empleado', 'trabajo', 'empleo', 'empresa']):
            return 'employed'
        elif any(word in text_lower for word in ['independiente', 'propio', 'cuenta propia', 'negocio propio']):
            return 'self_employed'
        elif any(word in text_lower for word in ['estudiante', 'estudio', 'universidad']):
            return 'student'
        elif any(word in text_lower for word in ['desempleado', 'sin trabajo', 'desempleo']):
            return 'unemployed'
        
        return None
    
    def _get_employment_details_question(self, employment_status: str) -> str:
        """Get employment details question based on status"""
        if employment_status == 'employed':
            return "Perfecto. ¿En qué empresa trabajas y cuánto tiempo llevas ahí?"
        else:  # self_employed
            return "Excelente. ¿A qué te dedicas? Describe brevemente tu negocio o actividad."
    
    def _validate_loan_amount(self, text: str) -> Tuple[bool, Optional[float]]:
        """Validate loan amount"""
        print(f"🔢 Validating loan amount: '{text}'")
        
        # Remove common words and clean the text
        clean_text = re.sub(r'\b(quetzales|mil|millón|millones|q)\b', '', text.lower())
        print(f"🧹 Cleaned text: '{clean_text}'")
        
        # Look for numbers - handle both comma and dot as thousands separator
        amount_patterns = [
            r'(\d{1,3}(?:[,\.]\d{3})*)',  # 100,000 or 100.000 or 150.000
            r'(\d+)\s*mil',                # 50 mil
            r'(\d+\.?\d*)\s*millón',       # 1.2 millón
            r'(\d+)',                      # Simple number like 150000
        ]
        
        for i, pattern in enumerate(amount_patterns):
            match = re.search(pattern, clean_text)
            if match:
                print(f"🎯 Pattern {i+1} matched: '{match.group(1)}'")
                try:
                    if 'mil' in text.lower():
                        amount = float(match.group(1).replace(',', '').replace('.', '')) * 1000
                        print(f"💰 Interpreted as thousand: {amount}")
                    elif 'millón' in text.lower():
                        amount = float(match.group(1).replace(',', '')) * 1000000
                        print(f"💰 Interpreted as million: {amount}")
                    else:
                        # Handle thousands separator (both comma and dot)
                        number_str = match.group(1)
                        print(f"🔍 Processing number string: '{number_str}'")
                        # If it has 3 digits after separator, treat separator as thousands
                        if '.' in number_str and len(number_str.split('.')[-1]) == 3:
                            amount = float(number_str.replace('.', ''))
                            print(f"💰 Interpreted as thousands (dot): {amount}")
                        elif ',' in number_str:
                            amount = float(number_str.replace(',', ''))
                            print(f"💰 Interpreted as thousands (comma): {amount}")
                        else:
                            amount = float(number_str)
                            print(f"💰 Interpreted as simple number: {amount}")
                    
                    print(f"✅ Final amount: {amount}, valid range: {5000 <= amount <= 1200000}")
                    if 5000 <= amount <= 1200000:
                        return True, amount
                except Exception as e:
                    print(f"❌ Error parsing amount '{match.group(1)}': {e}")
                    continue
        
        print(f"❌ No valid amount found in: '{text}'")
        return False, None

# Global conversation flow handler
conversation_flow = ConversationFlowHandler() 