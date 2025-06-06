# session_manager.py
"""
Session Management System for Ana - AI Contact Center Agent
Handles conversation states, application data, and flow control
"""

import time
import uuid
from typing import Dict, Any, Optional, List
from dataclasses import dataclass, field
from enum import Enum

class ConversationState(Enum):
    """Conversation states for the loan application flow"""
    # General states
    GENERAL_CHAT = "general_chat"
    FAQ_RESPONSE = "faq_response"
    AWAITING_TRANSITION_RESPONSE = "awaiting_transition_response"
    
    # Application onboarding states
    STATE_START_APPLICATION = "start_application"
    STATE_ASK_ELIGIBILITY_PERMISSION = "ask_eligibility_permission"
    STATE_ASK_MINIMUM_AGE = "ask_minimum_age"
    STATE_VALIDATE_MINIMUM_AGE = "validate_minimum_age"
    STATE_ASK_RESIDENCY = "ask_residency"
    STATE_VALIDATE_RESIDENCY = "validate_residency"
    STATE_ASK_MINIMUM_INCOME = "ask_minimum_income"
    STATE_VALIDATE_MINIMUM_INCOME = "validate_minimum_income"
    STATE_HANDLE_INITIAL_QUALIFICATION_RESULT = "handle_initial_qualification"
    STATE_ASK_FULL_NAME = "ask_full_name"
    STATE_VALIDATE_FULL_NAME = "validate_full_name"
    STATE_ASK_DPI = "ask_dpi"
    STATE_VALIDATE_DPI = "validate_dpi"
    STATE_ASK_DOB = "ask_dob"
    STATE_VALIDATE_DOB = "validate_dob"
    STATE_ASK_ADDRESS = "ask_address"
    STATE_VALIDATE_ADDRESS = "validate_address"
    STATE_ASK_PHONE = "ask_phone"
    STATE_VALIDATE_PHONE = "validate_phone"
    STATE_ASK_EMAIL = "ask_email"
    STATE_VALIDATE_EMAIL = "validate_email"
    STATE_ASK_EMPLOYMENT_STATUS = "ask_employment_status"
    STATE_VALIDATE_EMPLOYMENT_STATUS = "validate_employment_status"
    STATE_ASK_EMPLOYMENT_DETAILS = "ask_employment_details"
    STATE_ASK_LOAN_AMOUNT = "ask_loan_amount"
    STATE_VALIDATE_LOAN_AMOUNT = "validate_loan_amount"
    STATE_ASK_LOAN_PURPOSE = "ask_loan_purpose"
    STATE_ASK_CONSENT_DISCLOSURES = "ask_consent_disclosures"
    STATE_VALIDATE_CONSENT = "validate_consent"
    STATE_PROVIDE_APPLICATION_SUMMARY = "provide_application_summary"
    STATE_ASK_EMAIL_CONFIRMATION_PREFERENCE = "ask_email_confirmation_preference"
    STATE_END_APPLICATION_FLOW = "end_application_flow"

@dataclass
class ApplicationData:
    """Stores loan application data being collected"""
    # Personal Information
    full_name: Optional[str] = None
    dpi: Optional[str] = None
    date_of_birth: Optional[str] = None
    age: Optional[int] = None
    address: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    
    # Eligibility
    is_minimum_age: Optional[bool] = None
    is_guatemalan_resident: Optional[bool] = None
    has_minimum_income: Optional[bool] = None
    monthly_income: Optional[float] = None
    
    # Employment
    employment_status: Optional[str] = None  # "employed", "self_employed", "unemployed", "student"
    company_name: Optional[str] = None
    employment_time: Optional[str] = None
    business_type: Optional[str] = None
    
    # Loan Details
    loan_amount: Optional[float] = None
    loan_purpose: Optional[str] = None
    
    # Consent
    consent_given: Optional[bool] = None
    wants_email_confirmation: Optional[bool] = None
    
    # Application tracking
    application_id: Optional[str] = None
    created_at: Optional[str] = None
    qualified: Optional[bool] = None

@dataclass
class SessionData:
    """Stores session-specific data"""
    session_id: str
    current_state: ConversationState = ConversationState.GENERAL_CHAT
    application_data: ApplicationData = field(default_factory=ApplicationData)
    last_faq_response: Optional[str] = None
    retry_count: int = 0  # For validation retries
    last_user_input: Optional[str] = None
    conversation_history: List[Dict[str, Any]] = field(default_factory=list)
    created_at: float = field(default_factory=time.time)
    last_activity: float = field(default_factory=time.time)
    has_been_introduced: bool = False  # Track if Ana has been introduced

class SessionManager:
    """Manages conversation sessions and state transitions"""
    
    def __init__(self):
        self.sessions: Dict[str, SessionData] = {}
        self.session_timeout = 1800  # 30 minutes
    
    def get_session(self, session_id: str) -> SessionData:
        """Get or create session data"""
        if session_id not in self.sessions:
            self.sessions[session_id] = SessionData(session_id=session_id)
        
        # Update last activity
        self.sessions[session_id].last_activity = time.time()
        return self.sessions[session_id]
    
    def update_session_state(self, session_id: str, new_state: ConversationState) -> None:
        """Update session state"""
        session = self.get_session(session_id)
        session.current_state = new_state
        session.last_activity = time.time()
        
        # Reset retry count when changing states
        if new_state != session.current_state:
            session.retry_count = 0
    
    def increment_retry_count(self, session_id: str) -> int:
        """Increment retry count for validation failures"""
        session = self.get_session(session_id)
        session.retry_count += 1
        return session.retry_count
    
    def reset_retry_count(self, session_id: str) -> None:
        """Reset retry count"""
        session = self.get_session(session_id)
        session.retry_count = 0
    
    def update_application_data(self, session_id: str, field: str, value: Any) -> None:
        """Update application data field"""
        session = self.get_session(session_id)
        setattr(session.application_data, field, value)
    
    def get_application_data(self, session_id: str) -> ApplicationData:
        """Get application data"""
        session = self.get_session(session_id)
        return session.application_data
    
    def start_application_flow(self, session_id: str) -> None:
        """Initialize application flow"""
        session = self.get_session(session_id)
        session.current_state = ConversationState.STATE_ASK_ELIGIBILITY_PERMISSION
        session.application_data = ApplicationData()
        session.application_data.application_id = f"APP_{int(time.time())}_{uuid.uuid4().hex[:8]}"
        session.application_data.created_at = time.strftime("%Y-%m-%d %H:%M:%S")
        session.retry_count = 0
    
    def mark_as_introduced(self, session_id: str) -> None:
        """Mark that Ana has been introduced to this user"""
        session = self.get_session(session_id)
        session.has_been_introduced = True
    
    def has_been_introduced(self, session_id: str) -> bool:
        """Check if Ana has been introduced to this user"""
        session = self.get_session(session_id)
        return session.has_been_introduced
    
    def is_qualified(self, session_id: str) -> bool:
        """Check if applicant meets basic qualification criteria"""
        app_data = self.get_application_data(session_id)
        
        qualifications = [
            app_data.is_minimum_age,
            app_data.is_guatemalan_resident,
            app_data.has_minimum_income
        ]
        
        return all(qual is True for qual in qualifications)
    
    def cleanup_expired_sessions(self) -> None:
        """Remove expired sessions"""
        current_time = time.time()
        expired_sessions = [
            session_id for session_id, session_data in self.sessions.items()
            if current_time - session_data.last_activity > self.session_timeout
        ]
        
        for session_id in expired_sessions:
            del self.sessions[session_id]
    
    def get_session_summary(self, session_id: str) -> Dict[str, Any]:
        """Get session summary for debugging"""
        if session_id not in self.sessions:
            return {"error": "Session not found"}
        
        session = self.sessions[session_id]
        return {
            "session_id": session_id,
            "current_state": session.current_state.value,
            "retry_count": session.retry_count,
            "application_data": {
                "application_id": session.application_data.application_id,
                "full_name": session.application_data.full_name,
                "qualified": session.application_data.qualified,
                "loan_amount": session.application_data.loan_amount
            },
            "last_activity": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(session.last_activity))
        }

# Global session manager instance
session_manager = SessionManager()

# Helper functions for common operations
def get_current_state(session_id: str) -> ConversationState:
    """Get current conversation state"""
    return session_manager.get_session(session_id).current_state

def update_state(session_id: str, new_state: ConversationState) -> None:
    """Update conversation state"""
    session_manager.update_session_state(session_id, new_state)

def is_in_application_flow(session_id: str) -> bool:
    """Check if session is in application flow"""
    state = get_current_state(session_id)
    return state.value.startswith("STATE_") or state == ConversationState.AWAITING_TRANSITION_RESPONSE

def get_retry_count(session_id: str) -> int:
    """Get current retry count"""
    return session_manager.get_session(session_id).retry_count 