# app.py
from flask import Flask, render_template, request, jsonify, send_from_directory, Response
import os
import uuid
import torch # For checking cuda availability for TTS
import warnings
import json # For SSE data
import time # For timing and unique filenames

# Suppress future warnings for cleaner logs (optional)
warnings.filterwarnings("ignore", category=FutureWarning)
warnings.filterwarnings("ignore", category=UserWarning)

# Import your custom modules
import tts_module
import llm_module
import memory_module
import stt_module # Using Whisper STT

# Import Ana's conversation system
import faq_knowledge_base
import session_manager
import conversation_flow
from session_manager import ConversationState
import conversation_logger as conv_log

app = Flask(__name__, static_folder='static', static_url_path='/static')

# --- Configuration ---
from dotenv import load_dotenv
load_dotenv()

DEEPSEEK_API_KEY = os.environ.get("DEEPSEEK_API_KEY", "YOUR_DEEPSEEK_API_KEY_HERE")
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "YOUR_OPENAI_API_KEY_HERE")
SUPABASE_URL = os.environ.get("SUPABASE_URL", "YOUR_SUPABASE_URL_HERE")
# Ensure you are using the SERVICE KEY for Supabase from backend
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", os.environ.get("SUPABASE_API_KEY", "YOUR_SUPABASE_SERVICE_KEY_HERE"))

# Google Cloud credentials setup
if "GOOGLE_CREDENTIALS_JSON" in os.environ:
    creds_path = "/tmp/google_credentials.json"
    with open(creds_path, "w") as f:
        f.write(os.environ["GOOGLE_CREDENTIALS_JSON"])
    os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = creds_path
    print(f"✅ Set Google Cloud credentials from environment variable")
elif os.environ.get("GOOGLE_CREDENTIALS_PATH"):
    creds_path = os.environ["GOOGLE_CREDENTIALS_PATH"]
    if os.path.exists(creds_path):
        os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = creds_path
        print(f"✅ Set Google Cloud credentials: {creds_path}")
    else:
        print(f"⚠️  Google Cloud credentials not found at: {creds_path}")
        print("   STT may not work properly without valid credentials.")

# LLM Configuration - Set USE_OPENAI=True to use OpenAI instead of Deepseek
USE_OPENAI = True # Set to False to use Deepseek by default

UPLOAD_FOLDER = 'uploads'
STATIC_FOLDER = 'static'

os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs(STATIC_FOLDER, exist_ok=True)

app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
app.config['STATIC_FOLDER'] = STATIC_FOLDER

# --- Module Initialization ---
print("Starting module initialization...")
try:
    tts_module.initialize_tts()
except Exception as e: print(f"ERROR initializing TTS: {e}")

try:
    if USE_OPENAI:
        if OPENAI_API_KEY and OPENAI_API_KEY != "YOUR_OPENAI_API_KEY_HERE":
            llm_module.initialize_llm(api_key=None, use_openai=True, openai_api_key=OPENAI_API_KEY)
        else:
            print("WARNING: OpenAI API key is a placeholder or missing. LLM will not function correctly if USE_OPENAI is True.")
    else: # Use Deepseek
        if DEEPSEEK_API_KEY and DEEPSEEK_API_KEY != "YOUR_DEEPSEEK_API_KEY_HERE":
            llm_module.initialize_llm(api_key=DEEPSEEK_API_KEY, use_openai=False)
        else:
            print("WARNING: Deepseek API key is a placeholder or missing. LLM will not function correctly if USE_OPENAI is False.")
except Exception as e: print(f"ERROR initializing LLM: {e}")

try:
    if SUPABASE_URL != "YOUR_SUPABASE_URL_HERE" and SUPABASE_KEY != "YOUR_SUPABASE_SERVICE_KEY_HERE":
        memory_module.initialize_memory(url=SUPABASE_URL, key=SUPABASE_KEY)
    else:
        print("WARNING: Supabase URL/Key are placeholders. Memory will not function correctly.")
except Exception as e: print(f"ERROR initializing Memory: {e}")

try:
    stt_module.initialize_stt(model_size="base")
except Exception as e:
    print(f"ERROR initializing STT: {e}. Make sure 'openai-whisper' and 'ffmpeg' (if on windows) are installed.")
print("Module initialization phase completed.")


@app.route('/')
def index():
    return render_template('index.html')

@app.route('/debug/<session_id>')
def get_session_debug(session_id):
    """Get debug logs for a specific session"""
    try:
        logs = conv_log.get_session_logs(session_id)
        return f"<pre>{logs}</pre>", 200, {'Content-Type': 'text/html; charset=utf-8'}
    except Exception as e:
        return f"Error retrieving logs: {e}", 500

@app.route('/debug/<session_id>/download')
def download_session_debug(session_id):
    """Download debug logs for a specific session as a file"""
    try:
        debug_file = conv_log.create_debug_file(session_id)
        if debug_file:
            from flask import send_file
            return send_file(debug_file, as_attachment=True, download_name=f"debug_{session_id}.log")
        else:
            return "Could not create debug file", 500
    except Exception as e:
        return f"Error creating debug file: {e}", 500

@app.route('/chat', methods=['POST'])
def chat_endpoint():
    overall_start_time = time.time()

    if 'audio_data' not in request.files:
        # This part will execute before streaming, so a normal JSON error is fine
        return jsonify({'error': 'No audio file part in the request'}), 400
    audio_file = request.files['audio_data']
    if audio_file.filename == '':
        return jsonify({'error': 'No selected audio file'}), 400

    session_id = request.form.get('session_id', str(uuid.uuid4()))
    unique_session_tag = f"{session_id}_{int(time.time())}" # For unique chunk filenames
    
    print(f"🔗 Session ID: {session_id} | Debug at: http://localhost:5000/debug/{session_id}")

    # Save the uploaded file first with original format detection
    uploaded_audio_filename = f"user_audio_{unique_session_tag}"  # No extension yet
    uploaded_audio_path = os.path.join(app.config['UPLOAD_FOLDER'], uploaded_audio_filename)
    
    file_save_start = time.time()
    audio_file.save(uploaded_audio_path)
    
    # Validate saved file
    file_size = os.path.getsize(uploaded_audio_path) if os.path.exists(uploaded_audio_path) else 0
    print(f"⏱️ User audio saved: {uploaded_audio_path} ({time.time() - file_save_start:.3f}s)")
    print(f"📊 Saved file size: {file_size} bytes")
    
    # Early validation
    if file_size < 100:
        print("⚠️  WARNING: User audio file is very small, possible recording issue")
        return jsonify({'error': 'Audio file too small - please try recording again'}), 400
    
    # Detect and convert audio format for STT compatibility
    def detect_and_convert_audio(input_path):
        """Detect audio format and convert to WAV if needed for STT"""
        try:
            # Read first few bytes to detect format
            with open(input_path, 'rb') as f:
                header = f.read(16)
            
            print(f"📋 Audio header: {header[:8]}")
            
            # Detect format based on file headers
            if header.startswith(b'\x1a\x45\xdf\xa3'):
                print("📱 Detected format: WEBM")
                return input_path + ".webm"  # Return with proper extension
            elif header.startswith(b'RIFF'):
                print("📱 Detected format: WAV")
                return input_path + ".wav"
            elif header.startswith(b'OggS'):
                print("📱 Detected format: OGG")
                return input_path + ".ogg"
            elif header.startswith(b'fLaC'):
                print("📱 Detected format: FLAC")
                return input_path + ".flac"
            else:
                print(f"📱 Unknown format, assuming WEBM (header: {header[:8]})")
                return input_path + ".webm"
                
        except Exception as e:
            print(f"❌ Error detecting format: {e}")
            return input_path + ".wav"  # Default fallback
    
    # Detect format and rename file with proper extension
    detected_audio_path = detect_and_convert_audio(uploaded_audio_path)
    if detected_audio_path != uploaded_audio_path:
        os.rename(uploaded_audio_path, detected_audio_path)
        uploaded_audio_path = detected_audio_path
        print(f"🔄 Renamed to: {uploaded_audio_path}")

    if stt_module.stt_client is None:
        return jsonify({'error': 'STT service not available.'}), 500
    
    stt_start_time = time.time()
    user_text = stt_module.transcribe_audio(uploaded_audio_path, language="es") # Force Spanish
    print(f"⏱️ STT ({user_text}): {time.time() - stt_start_time:.3f}s")

    if not user_text or "Error" in user_text:
        conv_log.log_error(session_id, "STT_FAILURE", f"Transcription failed: {user_text}")
        return jsonify({'error': 'Failed to transcribe audio', 'details': user_text, 'suggestion': 'Please speak louder and try again'}), 500

    history = []
    if memory_module.supabase_client: # Check if client is initialized
        try:
            history = memory_module.get_history(session_id, limit=3) # Limit history for speed
        except Exception as e:
            print(f"Error retrieving history: {e}")

    # Now, define the generator for Server-Sent Events with Ana's conversation flow
    def event_stream():
        # 1. Send transcribed user text to client
        yield f"data: {json.dumps({'type': 'user_text_final', 'text': user_text, 'session_id': session_id})}\n\n"

        # Log conversation start
        conv_log.log_conversation_start(session_id, user_text)
        
        try:
            # Check if Ana needs to introduce herself for this session_id
            first_interaction_in_session = not session_manager.session_manager.has_been_introduced(session_id)

            if first_interaction_in_session:
                intro_speech = "¡Hola! Soy Ana, tu asistente virtual de Club Cash In. ¿En qué puedo ayudarte hoy?"
                conv_log.log_ana_response(session_id, "INTRODUCTION", intro_speech)
                conv_log.log_debug(session_id, f"First interaction - introducing Ana. User said: '{user_text}'")
                yield from generate_ana_response(intro_speech, session_id, unique_session_tag)
                session_manager.session_manager.mark_as_introduced(session_id)
                
                # ALWAYS end turn after introduction to prevent double processing/audio
                conv_log.log_debug(session_id, "Ending turn after introduction to prevent audio duplication")
                conv_log.log_conversation_end(session_id, time.time() - overall_start_time, 1)
                yield f"data: {json.dumps({'type': 'end_of_stream'})}\n\n"
                return  # CRITICAL: Always stop after introduction

            # --- Main Logic based on state (Ana has been introduced or first query is not a simple greeting) ---
            current_state = session_manager.get_current_state(session_id)

            if current_state == ConversationState.GENERAL_CHAT:
                user_lower = user_text.lower().strip()
                ana_response = None  # Default to no pre-canned response

                # FIRST PRIORITY: Check for other contextual responses
                if any(word in user_lower for word in ["gracias", "muchas gracias", "ok", "bueno", "bien", "entiendo", "claro"]):
                    ana_response = "¡De nada! ¿Hay algo más en lo que te pueda ayudar hoy?"
                    conv_log.log_ana_response(session_id, "THANKS_RESPONSE", ana_response)
                    yield from generate_ana_response(ana_response, session_id, unique_session_tag)
                elif any(user_lower == greet for greet in ["hola", "buenos días", "buenas tardes", "buenas noches"]):  # Simple greeting after intro
                    ana_response = "¡Hola de nuevo! ¿En qué puedo asistirte?"
                    conv_log.log_ana_response(session_id, "REPEAT_GREETING", ana_response)
                    yield from generate_ana_response(ana_response, session_id, unique_session_tag)
                
                # SECOND PRIORITY: Try to match FAQ first (to catch information requests)
                else:
                    faq_match = faq_knowledge_base.find_faq_intent(user_text)
                    if faq_match:
                        print(f"🔍 FAQ Intent matched: {faq_match['intent_name']}")
                        conv_log.log_faq_match(session_id, user_text, faq_match['intent_name'])
                        
                        faq_response_text = faq_knowledge_base.get_faq_response(faq_match)
                        conv_log.log_ana_response(session_id, "FAQ_RESPONSE", faq_response_text)
                        yield from generate_ana_response(faq_response_text, session_id, unique_session_tag)
                        
                        transition_question = faq_knowledge_base.get_transition_question()
                        conv_log.log_state_change(session_id, "GENERAL_CHAT", "AWAITING_TRANSITION_RESPONSE")
                        conv_log.log_transition_question(session_id)
                        session_manager.update_state(session_id, ConversationState.AWAITING_TRANSITION_RESPONSE)
                        yield from generate_ana_response(transition_question, session_id, unique_session_tag)
                    
                    # THIRD PRIORITY: Check for explicit application requests (more specific patterns)
                    elif any(phrase in user_lower for phrase in [
                        "solicitar un préstamo", "aplicar para un préstamo", "pedir un préstamo",
                        "iniciar solicitud", "empezar solicitud", "hacer una solicitud",
                        "solicitud de préstamo", "aplicación de préstamo",
                        "quiero un préstamo", "necesito un préstamo", "solicito un préstamo"
                    ]):
                        # Start application flow directly - no need for extra confirmation
                        session_manager.session_manager.start_application_flow(session_id)
                        ana_response = conversation_flow.conversation_flow.get_initial_question(ConversationState.STATE_ASK_ELIGIBILITY_PERMISSION)
                        conv_log.log_state_change(session_id, "GENERAL_CHAT", "STATE_ASK_ELIGIBILITY_PERMISSION")
                        conv_log.log_ana_response(session_id, "APPLICATION_START", ana_response)
                        session_manager.update_state(session_id, ConversationState.STATE_ASK_ELIGIBILITY_PERMISSION)
                        yield from generate_ana_response(ana_response, session_id, unique_session_tag)
                
                    # FOURTH PRIORITY: General chat / LLM fallback
                    else:
                        print(f"❌ No FAQ or application request found, providing contextual response for: '{user_text}'")
                        conv_log.log_faq_no_match(session_id, user_text)
                        
                        # Fallback to LLM for unhandled general chat
                        if llm_module.client is not None:
                            ana_prompt = f"""Eres Ana, una asistente virtual amigable y profesional de una empresa de préstamos en Guatemala. Tu objetivo principal es ayudar con información de préstamos o guiar en el proceso de solicitud. Respondes en español de manera cálida y concisa. El usuario dice: "{user_text}" """
                            llm_response_generator = llm_module.get_ai_response(ana_prompt, conversation_history=history)
                            full_llm_response = ""
                            for chunk in llm_response_generator:
                                if chunk:
                                    full_llm_response += chunk
                            if full_llm_response.strip():
                                conv_log.log_llm_fallback(session_id, user_text, full_llm_response)
                                yield from generate_ana_response(full_llm_response, session_id, unique_session_tag)
                            else:  # LLM gave empty response
                                fallback_response = "Disculpa, no estoy segura de cómo responder a eso. ¿Podrías reformular tu pregunta? Puedo ayudarte con información sobre préstamos o iniciar una solicitud."
                                conv_log.log_ana_response(session_id, "LLM_EMPTY_FALLBACK", fallback_response)
                                yield from generate_ana_response(fallback_response, session_id, unique_session_tag)
                        else:  # LLM not available
                            fallback_response = "Disculpa, no pude entender tu pregunta. Puedo ayudarte con información sobre nuestros préstamos o iniciar una solicitud."
                            conv_log.log_ana_response(session_id, "NO_LLM_FALLBACK", fallback_response)
                            yield from generate_ana_response(fallback_response, session_id, unique_session_tag)

            elif current_state == ConversationState.AWAITING_TRANSITION_RESPONSE:
                # User is responding to "Do you want to start an application?"
                conv_log.log_debug(session_id, f"Processing transition response: '{user_text}'")
                
                # FIRST: Try to process as transition response (affirmative/negative)
                conv_log.log_debug(session_id, f"Attempting to process as transition response")
                flow_result = conversation_flow.conversation_flow.process_user_input(session_id, user_text)
                conv_log.log_debug(session_id, f"Flow result: {flow_result}")
                
                # If flow successfully processed the transition (user said yes/no), continue with flow
                if flow_result['success'] or flow_result['next_state'] != ConversationState.AWAITING_TRANSITION_RESPONSE:
                    conv_log.log_debug(session_id, f"Successfully processed as transition response")
                    
                    if flow_result['success']:
                        old_state = current_state.value
                        new_state = flow_result['next_state']
                        conv_log.log_state_change(session_id, old_state, new_state.value if hasattr(new_state, 'value') else str(new_state))
                        session_manager.update_state(session_id, flow_result['next_state'])
                        conv_log.log_ana_response(session_id, "TRANSITION_SUCCESS", flow_result['response'])
                        yield from generate_ana_response(flow_result['response'], session_id, unique_session_tag)
                    
                        # If the next step involves Ana asking another question immediately:
                        if flow_result['next_state'] not in [ConversationState.GENERAL_CHAT, ConversationState.STATE_HANDLE_INITIAL_QUALIFICATION_RESULT, ConversationState.STATE_PROVIDE_APPLICATION_SUMMARY]:
                            # This might be implicit if flow_result['response'] IS the next question
                            conv_log.log_debug(session_id, f"Next state requires immediate question: {flow_result['next_state']}")
                            pass
                        elif flow_result['next_state'] == ConversationState.STATE_HANDLE_INITIAL_QUALIFICATION_RESULT:
                            conv_log.log_debug(session_id, "Handling qualification result")
                            qualification_result = conversation_flow.conversation_flow._handle_qualification_result(session_id)
                            session_manager.update_state(session_id, qualification_result['next_state'])
                            conv_log.log_ana_response(session_id, "QUALIFICATION_RESULT", qualification_result['response'])
                            yield from generate_ana_response(qualification_result['response'], session_id, unique_session_tag)
                            # Ask the next question automatically
                            if qualification_result['next_state'] == ConversationState.STATE_ASK_FULL_NAME:
                                next_question = conversation_flow.conversation_flow.get_initial_question(ConversationState.STATE_ASK_FULL_NAME)
                                conv_log.log_ana_response(session_id, "AUTO_NEXT_QUESTION", next_question)
                                yield from generate_ana_response(next_question, session_id, unique_session_tag)
                        elif flow_result['next_state'] == ConversationState.STATE_PROVIDE_APPLICATION_SUMMARY:
                            conv_log.log_debug(session_id, "Providing application summary")
                            summary_result = conversation_flow.conversation_flow._provide_application_summary(session_id)
                            session_manager.update_state(session_id, summary_result['next_state'])  # Should go to GENERAL_CHAT
                            conv_log.log_ana_response(session_id, "APPLICATION_SUMMARY", summary_result['response'])
                            yield from generate_ana_response(summary_result['response'], session_id, unique_session_tag)
                    else:
                        # Failed to process as transition, still in AWAITING_TRANSITION_RESPONSE
                        conv_log.log_debug(session_id, f"Failed to process as transition, trying validation error")
                        session_manager.update_state(session_id, flow_result['next_state'])  # State might remain to re-ask
                        conv_log.log_ana_response(session_id, "TRANSITION_VALIDATION_ERROR", flow_result['response'])
                        yield from generate_ana_response(flow_result['response'], session_id, unique_session_tag)
                        
                else:
                    # Could not process as transition response - maybe it's an FAQ question instead
                    conv_log.log_debug(session_id, f"Could not process as transition, checking if it's an FAQ")
                    faq_match_instead_of_transition = faq_knowledge_base.find_faq_intent(user_text)
                    if faq_match_instead_of_transition:
                        print(f"🔍 User asked FAQ ({faq_match_instead_of_transition['intent_name']}) instead of answering transition.")
                        conv_log.log_faq_match(session_id, user_text, faq_match_instead_of_transition['intent_name'])
                        
                        faq_response_text = faq_knowledge_base.get_faq_response(faq_match_instead_of_transition)
                        conv_log.log_ana_response(session_id, "FAQ_DURING_TRANSITION", faq_response_text)
                        yield from generate_ana_response(faq_response_text, session_id, unique_session_tag)
                        
                        # Re-ask the transition question as the state is still AWAITING_TRANSITION_RESPONSE
                        transition_question = faq_knowledge_base.get_transition_question()
                        conv_log.log_ana_response(session_id, "RE_ASK_TRANSITION", transition_question)
                        yield from generate_ana_response(transition_question, session_id, unique_session_tag)
                    else:
                        # Neither transition nor FAQ - provide clarification
                        conv_log.log_debug(session_id, f"Neither transition nor FAQ - asking for clarification")
                        clarification = "No entendí tu respuesta. ¿Te gustaría que te ayude a iniciar una solicitud de préstamo? Por favor responde 'sí' o 'no'."
                        conv_log.log_ana_response(session_id, "TRANSITION_CLARIFICATION", clarification)
                        yield from generate_ana_response(clarification, session_id, unique_session_tag)

            else:  # User is in other application flow states (e.g., STATE_ASK_MINIMUM_AGE, etc.)
                flow_result = conversation_flow.conversation_flow.process_user_input(session_id, user_text)
                if flow_result['success']:
                    session_manager.update_state(session_id, flow_result['next_state'])
                    yield from generate_ana_response(flow_result['response'], session_id, unique_session_tag)
                    
                    # Handle special states that need additional processing
                    if flow_result['next_state'] == ConversationState.STATE_HANDLE_INITIAL_QUALIFICATION_RESULT:
                        conv_log.log_debug(session_id, "Handling qualification result in main flow")
                        qualification_result = conversation_flow.conversation_flow._handle_qualification_result(session_id)
                        session_manager.update_state(session_id, qualification_result['next_state'])
                        conv_log.log_ana_response(session_id, "QUALIFICATION_RESULT", qualification_result['response'])
                        yield from generate_ana_response(qualification_result['response'], session_id, unique_session_tag)
                        # Ask the next question automatically
                        if qualification_result['next_state'] == ConversationState.STATE_ASK_FULL_NAME:
                            next_question = conversation_flow.conversation_flow.get_initial_question(ConversationState.STATE_ASK_FULL_NAME)
                            conv_log.log_ana_response(session_id, "AUTO_NEXT_QUESTION", next_question)
                            yield from generate_ana_response(next_question, session_id, unique_session_tag)
                    elif flow_result['next_state'] == ConversationState.STATE_PROVIDE_APPLICATION_SUMMARY:
                        summary_result = conversation_flow.conversation_flow._provide_application_summary(session_id)
                        session_manager.update_state(session_id, summary_result['next_state'])  # Should go to GENERAL_CHAT
                        yield from generate_ana_response(summary_result['response'], session_id, unique_session_tag)
                    # NOTE: Most states already include their next question in flow_result['response']
                    # Only add automatic questions for states that explicitly need it (currently none)

                else:  # flow_result not successful
                    session_manager.update_state(session_id, flow_result['next_state'])
                    yield from generate_ana_response(flow_result['response'], session_id, unique_session_tag)

            # Save interaction to memory
            if memory_module.supabase_client:
                memory_module.save_interaction(session_id, user_text, "Ana response processed")
            
            # Log conversation end
            total_time = time.time() - overall_start_time
            conv_log.log_conversation_end(session_id, total_time, 1)
            
            yield f"data: {json.dumps({'type': 'end_of_stream'})}\n\n"
            print(f"⏱️ === ANA RESPONSE COMPLETED IN: {total_time:.3f}s ===")

        except Exception as e_stream:
            print(f"❌ Error in Ana's conversation flow: {e_stream}")
            conv_log.log_error(session_id, "CONVERSATION_FLOW", str(e_stream))
            yield f"data: {json.dumps({'type': 'error', 'message': str(e_stream)})}\n\n"
        finally:
            # Clean up uploaded user audio file
            try:
                if os.path.exists(uploaded_audio_path):
                    os.remove(uploaded_audio_path)
            except OSError as e_del:
                print(f"Error deleting user audio file {uploaded_audio_path}: {e_del}")

    def generate_ana_response(response_text, session_id, unique_session_tag):
        """Generate Ana's TTS response and stream it to client"""
        if not response_text.strip():
            return
        
        # Clean and normalize the text first
        import re
        import unicodedata
        
        # Normalize unicode characters (fix encoding issues)
        clean_text = unicodedata.normalize('NFKC', response_text)
        
        # Remove extra whitespace and non-printable characters (but keep % symbol for interest rates)
        clean_text = re.sub(r'\s+', ' ', clean_text.strip())
        clean_text = re.sub(r'[^\w\s.!?¿¡,:;()\-áéíóúüñÁÉÍÓÚÜÑ%]', '', clean_text)
        
        conv_log.log_debug(session_id, f"Original text: '{response_text}'")
        conv_log.log_debug(session_id, f"Cleaned text: '{clean_text}'")
        
        # Split response into sentences for chunked delivery - keeping punctuation with sentences
        # Handle lists and percentages properly by looking for complete sentences
        sentences = re.split(r'(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚÜÑ¿¡])', clean_text)
        sentences = [s.strip() for s in sentences if s.strip() and len(s) > 5]
        
        conv_log.log_debug(session_id, f"Split into {len(sentences)} sentences: {sentences}")
        
        for sentence in sentences:
            if len(sentence) < 5:  # Skip very short fragments
                conv_log.log_debug(session_id, f"Skipping short sentence: '{sentence}'")
                continue
                
            tts_chunk_start_time = time.time()
            # Use precise timestamp to ensure unique filenames across all calls
            precise_timestamp = int(time.time() * 1000000)  # microseconds
            ai_audio_chunk_filename = f"ana_chunk_{session_id}_{precise_timestamp}.wav"
            ai_audio_chunk_path = os.path.join(app.config['STATIC_FOLDER'], ai_audio_chunk_filename)

            try:
                if tts_module.client is None:
                    yield f"data: {json.dumps({'type': 'error', 'message': 'TTS service not initialized.'})}\n\n"
                else:
                    # Final cleaning before TTS
                    tts_sentence = sentence.strip()
                    if not tts_sentence:
                        conv_log.log_debug(session_id, f"Empty sentence after cleaning, skipping TTS")
                        continue
                    
                    conv_log.log_debug(session_id, f"Generating TTS for: '{tts_sentence}' -> {ai_audio_chunk_filename}")
                    tts_module.generate_speech(tts_sentence, ai_audio_chunk_path, ultra_fast=True)
                    ai_audio_chunk_url = f"/static/{ai_audio_chunk_filename}"
                    yield f"data: {json.dumps({'type': 'ai_audio_chunk', 'url': ai_audio_chunk_url, 'text_spoken': tts_sentence})}\n\n"
                    print(f"🎵 Ana TTS: '{tts_sentence[:30]}...' ({time.time() - tts_chunk_start_time:.3f}s)")
            except Exception as e_tts:
                conv_log.log_error(session_id, "TTS_ERROR", f"Failed to generate TTS for '{sentence}': {e_tts}")
                print(f"❌ Ana TTS error: {e_tts}")
                yield f"data: {json.dumps({'type': 'error', 'message': f'TTS error: {e_tts}'})}\n\n"

    return Response(event_stream(), mimetype='text/event-stream')

# Route to serve static audio files (Flask static serving should handle this, but explicit can be useful)
@app.route('/static/<path:filename>')
def serve_static_audio(filename):
    return send_from_directory(app.config['STATIC_FOLDER'], filename)

if __name__ == '__main__':
    # ... (rest of your __main__ block)
    print("Starting Flask app for real-time conversation...")
    llm_provider_name = "OpenAI" if USE_OPENAI else "Deepseek"
    print(f"Using LLM Provider: {llm_provider_name}")
    # ...
    app.run(debug=True, port=5000, threaded=True) # threaded=True can help with concurrent requests/streams