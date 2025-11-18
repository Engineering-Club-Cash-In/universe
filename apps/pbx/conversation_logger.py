import logging
import json
import os
from datetime import datetime
from typing import Dict, Any, Optional

class ConversationLogger:
    """Logs conversation flow for debugging and analysis"""
    
    def __init__(self, log_dir: str = "logs"):
        self.log_dir = log_dir
        os.makedirs(log_dir, exist_ok=True)
        
        # Setup main conversation logger
        self.logger = logging.getLogger('ana_conversations')
        self.logger.setLevel(logging.DEBUG)
        
        # Remove existing handlers to avoid duplicates
        self.logger.handlers.clear()
        
        # File handler for all conversations
        log_file = os.path.join(log_dir, f"ana_conversations_{datetime.now().strftime('%Y%m%d')}.log")
        file_handler = logging.FileHandler(log_file, encoding='utf-8')
        file_handler.setLevel(logging.DEBUG)
        
        # Console handler for debugging
        console_handler = logging.StreamHandler()
        console_handler.setLevel(logging.WARNING)
        
        # Formatter
        formatter = logging.Formatter(
            '%(asctime)s | %(levelname)s | %(message)s',
            datefmt='%Y-%m-%d %H:%M:%S'
        )
        file_handler.setFormatter(formatter)
        console_handler.setFormatter(formatter)
        
        self.logger.addHandler(file_handler)
        self.logger.addHandler(console_handler)
        
        self.logger.info("=== Ana Conversation Logger Initialized ===")
    
    def log_conversation_start(self, session_id: str, user_text: str):
        """Log start of conversation turn"""
        self.logger.info(f"🎬 SESSION_START | {session_id} | USER: '{user_text}'")
    
    def log_state_change(self, session_id: str, old_state: str, new_state: str):
        """Log conversation state changes"""
        self.logger.info(f"🔄 STATE_CHANGE | {session_id} | {old_state} -> {new_state}")
    
    def log_faq_match(self, session_id: str, user_text: str, faq_intent: str, confidence: float = 0.0):
        """Log FAQ matching"""
        self.logger.info(f"🔍 FAQ_MATCH | {session_id} | '{user_text}' -> {faq_intent} (confidence: {confidence})")
    
    def log_faq_no_match(self, session_id: str, user_text: str):
        """Log when no FAQ matches"""
        self.logger.info(f"❌ FAQ_NO_MATCH | {session_id} | '{user_text}'")
    
    def log_ana_response(self, session_id: str, response_type: str, response_text: str):
        """Log Ana's responses"""
        # Truncate very long responses for readability
        display_text = response_text[:100] + "..." if len(response_text) > 100 else response_text
        self.logger.info(f"🗣️ ANA_RESPONSE | {session_id} | {response_type} | '{display_text}'")
    
    def log_transition_question(self, session_id: str):
        """Log when transition question is asked"""
        self.logger.info(f"🔀 TRANSITION_QUESTION | {session_id} | Asked loan application transition")
    
    def log_user_validation(self, session_id: str, field: str, value: str, is_valid: bool, retry_count: int = 0):
        """Log user input validation"""
        status = "VALID" if is_valid else "INVALID"
        self.logger.info(f"✅ USER_VALIDATION | {session_id} | {field}: '{value}' -> {status} (retry: {retry_count})")
    
    def log_application_progress(self, session_id: str, step: str, data: Dict[str, Any]):
        """Log application flow progress"""
        self.logger.info(f"📋 APP_PROGRESS | {session_id} | {step} | {json.dumps(data, ensure_ascii=False)}")
    
    def log_error(self, session_id: str, error_type: str, error_message: str):
        """Log errors"""
        self.logger.error(f"❌ ERROR | {session_id} | {error_type} | {error_message}")
    
    def log_llm_fallback(self, session_id: str, user_text: str, llm_response: str):
        """Log when LLM is used as fallback"""
        llm_short = llm_response[:50] + "..." if len(llm_response) > 50 else llm_response
        self.logger.info(f"🤖 LLM_FALLBACK | {session_id} | USER: '{user_text}' | LLM: '{llm_short}'")
    
    def log_session_summary(self, session_id: str, summary_data: Dict[str, Any]):
        """Log session summary"""
        self.logger.info(f"📊 SESSION_SUMMARY | {session_id} | {json.dumps(summary_data, ensure_ascii=False)}")
    
    def log_conversation_end(self, session_id: str, total_time: float, interaction_count: int):
        """Log end of conversation turn"""
        self.logger.info(f"🏁 SESSION_END | {session_id} | Time: {total_time:.2f}s | Interactions: {interaction_count}")
    
    def log_debug(self, session_id: str, message: str, data: Optional[Dict[str, Any]] = None):
        """Log debugging information"""
        if data:
            self.logger.debug(f"🐛 DEBUG | {session_id} | {message} | {json.dumps(data, ensure_ascii=False)}")
        else:
            self.logger.debug(f"🐛 DEBUG | {session_id} | {message}")
    
    def get_session_logs(self, session_id: str, last_n_hours: int = 24) -> str:
        """Extract logs for a specific session"""
        try:
            log_file = os.path.join(self.log_dir, f"ana_conversations_{datetime.now().strftime('%Y%m%d')}.log")
            if not os.path.exists(log_file):
                return f"No log file found for today: {log_file}"
            
            session_logs = []
            with open(log_file, 'r', encoding='utf-8') as f:
                for line in f:
                    if session_id in line:
                        session_logs.append(line.strip())
            
            if session_logs:
                return "\n".join(session_logs)
            else:
                return f"No logs found for session: {session_id}"
                
        except Exception as e:
            return f"Error reading logs: {e}"
    
    def create_conversation_debug_file(self, session_id: str) -> str:
        """Create a dedicated debug file for a specific session"""
        try:
            debug_file = os.path.join(self.log_dir, f"debug_session_{session_id}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.log")
            session_logs = self.get_session_logs(session_id)
            
            with open(debug_file, 'w', encoding='utf-8') as f:
                f.write(f"=== DEBUG LOG FOR SESSION: {session_id} ===\n")
                f.write(f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
                f.write("=" * 60 + "\n\n")
                f.write(session_logs)
            
            return debug_file
        except Exception as e:
            self.log_error(session_id, "DEBUG_FILE_CREATION", str(e))
            return ""

# Global logger instance
conversation_logger = ConversationLogger()

# Convenience functions for easy import
def log_conversation_start(session_id: str, user_text: str):
    conversation_logger.log_conversation_start(session_id, user_text)

def log_state_change(session_id: str, old_state: str, new_state: str):
    conversation_logger.log_state_change(session_id, old_state, new_state)

def log_faq_match(session_id: str, user_text: str, faq_intent: str, confidence: float = 0.0):
    conversation_logger.log_faq_match(session_id, user_text, faq_intent, confidence)

def log_faq_no_match(session_id: str, user_text: str):
    conversation_logger.log_faq_no_match(session_id, user_text)

def log_ana_response(session_id: str, response_type: str, response_text: str):
    conversation_logger.log_ana_response(session_id, response_type, response_text)

def log_transition_question(session_id: str):
    conversation_logger.log_transition_question(session_id)

def log_user_validation(session_id: str, field: str, value: str, is_valid: bool, retry_count: int = 0):
    conversation_logger.log_user_validation(session_id, field, value, is_valid, retry_count)

def log_application_progress(session_id: str, step: str, data: Dict[str, Any]):
    conversation_logger.log_application_progress(session_id, step, data)

def log_error(session_id: str, error_type: str, error_message: str):
    conversation_logger.log_error(session_id, error_type, error_message)

def log_llm_fallback(session_id: str, user_text: str, llm_response: str):
    conversation_logger.log_llm_fallback(session_id, user_text, llm_response)

def log_session_summary(session_id: str, summary_data: Dict[str, Any]):
    conversation_logger.log_session_summary(session_id, summary_data)

def log_conversation_end(session_id: str, total_time: float, interaction_count: int):
    conversation_logger.log_conversation_end(session_id, total_time, interaction_count)

def get_session_logs(session_id: str) -> str:
    return conversation_logger.get_session_logs(session_id)

def create_debug_file(session_id: str) -> str:
    return conversation_logger.create_conversation_debug_file(session_id)

def log_debug(session_id: str, message: str, data: Optional[Dict[str, Any]] = None):
    conversation_logger.log_debug(session_id, message, data) 