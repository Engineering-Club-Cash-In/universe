# stt_module.py
import os
import io

# Global variables
stt_client = None
whisper_model = None
use_google_cloud = False

# Try to import Google Cloud Speech
try:
    from google.cloud import speech
    from google.api_core import exceptions as google_exceptions
    GOOGLE_CLOUD_AVAILABLE = True
except ImportError:
    GOOGLE_CLOUD_AVAILABLE = False
    print("⚠️  Google Cloud Speech not available, will use Whisper fallback")

# Try to import Whisper as fallback
try:
    import whisper
    WHISPER_AVAILABLE = True
except ImportError:
    WHISPER_AVAILABLE = False
    print("⚠️  Whisper not available, install with: pip install openai-whisper")

def initialize_stt(model_size="base"):
    """
    Initializes STT service with Google Cloud first, Whisper as fallback.
    """
    global stt_client, whisper_model, use_google_cloud
    
    # Try Google Cloud first
    if GOOGLE_CLOUD_AVAILABLE:
        try:
            print("🔄 Trying Google Cloud Speech-to-Text...")
            
            # Check for Google Cloud credentials
            credentials_path = os.environ.get('GOOGLE_APPLICATION_CREDENTIALS')
            if not credentials_path or not os.path.exists(credentials_path):
                print("⚠️  WARNING: GOOGLE_APPLICATION_CREDENTIALS not found or invalid.")
                print("   Falling back to Whisper...")
                raise Exception("No valid credentials")
            
            stt_client = speech.SpeechClient()
            
            # Test the connection with a quick call
            config = speech.RecognitionConfig(
                encoding=speech.RecognitionConfig.AudioEncoding.LINEAR16,
                language_code="es-MX",
            )
            
            use_google_cloud = True
            print("✅ Google Cloud Speech-to-Text initialized successfully!")
            
            # Also load Whisper as backup (don't return yet)
            if WHISPER_AVAILABLE:
                try:
                    print(f"🔄 Also loading Whisper ({model_size}) as backup...")
                    whisper_model = whisper.load_model(model_size)
                    print(f"✅ Whisper backup model ({model_size}) loaded successfully!")
                except Exception as e:
                    print(f"⚠️  Could not load Whisper backup: {e}")
            
            return
            
        except Exception as e:
            print(f"❌ Google Cloud Speech failed: {e}")
            print("🔄 Falling back to Whisper...")
    
    # Fallback to Whisper
    if WHISPER_AVAILABLE:
        try:
            print(f"🔄 Loading Whisper STT model ({model_size})...")
            whisper_model = whisper.load_model(model_size)
            use_google_cloud = False
            print(f"✅ Whisper STT model ({model_size}) loaded successfully!")
            return
        except Exception as e:
            print(f"❌ Error loading Whisper: {e}")
    
    # Both failed
    raise Exception("❌ No STT service available! Install either google-cloud-speech OR openai-whisper")


def transcribe_audio(audio_file_path, language=None):
    """
    Transcribes audio from a file path using Google Cloud Speech-to-Text.
    Args:
        audio_file_path (str): Path to the audio file
        language (str, optional): Language code (e.g., "es" for Spanish, "en" for English). 
                                 Default is "es-MX" for Spanish (Mexico).
    Returns:
        str: The transcribed text.
    """
    global stt_client
    if stt_client is None:
        raise Exception("STT client not initialized. Call initialize_stt() first.")
    
    try:
        if not os.path.exists(audio_file_path):
            return "Error: Audio file not found for transcription."
        
        # Default to Spanish (Guatemala) if no language specified
        if not language:
            language = "es-MX"
        elif language == "es":
            language = "es-MX"  # More specific Spanish variant for Mexico
        
        print(f"🎤 Transcribing audio: {audio_file_path} (language: {language})")
        
        # Read the audio file
        with io.open(audio_file_path, "rb") as audio_file:
            content = audio_file.read()
        
        # Debug: Check file size and basic info
        file_size = len(content)
        print(f"📊 Audio file size: {file_size} bytes")
        
        if file_size < 100:  # Very small file
            print("⚠️  WARNING: Audio file is very small, might be empty or corrupted")
            return "Error: Audio file too small or empty"
        
        # Check for basic audio file headers
        if content[:4] == b'RIFF':
            print("📋 Audio format: WAV/RIFF detected")
        elif content[:4] == b'OggS':
            print("📋 Audio format: OGG detected")
        elif content[:4] == b'fLaC':
            print("📋 Audio format: FLAC detected")
        else:
            print(f"📋 Audio format: Unknown (first 4 bytes: {content[:4]})")
            print("⚠️  Might be an unsupported format")
        
        # Configure the audio settings
        audio = speech.RecognitionAudio(content=content)
        
        # Base config without encoding (will be set in loop)
        base_config = {
            "language_code": language,
            "alternative_language_codes": ["es-MX", "es-ES"],  # Fallback Spanish variants
            "enable_automatic_punctuation": True,
            "model": "latest_long",  # Best model for accuracy
            "use_enhanced": True,  # Enhanced model for better accuracy
        }
        
        # Try different encodings and sample rates
        configs_to_try = [
            # Common web audio formats
            {"encoding": speech.RecognitionConfig.AudioEncoding.WEBM_OPUS},
            {"encoding": speech.RecognitionConfig.AudioEncoding.OGG_OPUS},
            # Linear PCM with common sample rates
            {"encoding": speech.RecognitionConfig.AudioEncoding.LINEAR16, "sample_rate_hertz": 48000},
            {"encoding": speech.RecognitionConfig.AudioEncoding.LINEAR16, "sample_rate_hertz": 44100},
            {"encoding": speech.RecognitionConfig.AudioEncoding.LINEAR16, "sample_rate_hertz": 16000},
            {"encoding": speech.RecognitionConfig.AudioEncoding.LINEAR16},  # Auto-detect
            # FLAC format
            {"encoding": speech.RecognitionConfig.AudioEncoding.FLAC},
        ]
        
        transcript = ""
        for config_attempt in configs_to_try:
            try:
                # Create config for this encoding attempt
                config_params = {**base_config, **config_attempt}
                config = speech.RecognitionConfig(**config_params)
                
                encoding_name = config_attempt["encoding"].name
                sample_rate = config_attempt.get("sample_rate_hertz", "auto")
                print(f"🔄 Trying encoding: {encoding_name} (sample rate: {sample_rate})")
                
                response = stt_client.recognize(config=config, audio=audio)
                
                if response.results:
                    # Get the most confident transcription
                    transcript = response.results[0].alternatives[0].transcript
                    confidence = response.results[0].alternatives[0].confidence
                    print(f"✅ Transcription successful with {encoding_name}")
                    print(f"🎯 Confidence: {confidence:.2f}")
                    break
                else:
                    print(f"⚠️  No results with {encoding_name}")
                    print(f"   Response metadata: {response}")
                    if hasattr(response, 'results'):
                        print(f"   Results count: {len(response.results)}")
                    
            except google_exceptions.InvalidArgument as e:
                print(f"❌ {encoding_name} failed: {e}")
                continue
            except Exception as e:
                print(f"❌ Unexpected error with {encoding_name}: {e}")
                continue
        
        if not transcript:
            print(f"❌ Google Cloud failed with all {len(configs_to_try)} configurations")
            
            # Fallback to Whisper if available
            if WHISPER_AVAILABLE and whisper_model is not None:
                print("🔄 Falling back to Whisper for transcription...")
                try:
                    # Whisper can handle most audio formats directly
                    result = whisper_model.transcribe(audio_file_path, language="es")
                    # Handle different return types from whisper
                    if isinstance(result, dict) and "text" in result:
                        text_value = result["text"]
                        whisper_transcript = text_value.strip() if isinstance(text_value, str) else str(text_value).strip()
                    else:
                        whisper_transcript = str(result).strip()
                    
                    if whisper_transcript:
                        print(f"✅ Whisper transcription successful: '{whisper_transcript}'")
                        return whisper_transcript
                    else:
                        print("❌ Whisper returned empty transcription")
                except Exception as whisper_error:
                    print(f"❌ Whisper fallback failed: {whisper_error}")
            
            # Both Google Cloud and Whisper failed
            error_msg = f"Error: Could not transcribe audio with any service. File size: {file_size} bytes, tried Google Cloud ({len(configs_to_try)} configs) and Whisper."
            print(f"❌ {error_msg}")
            return error_msg
        
        print(f"📝 Transcribed: '{transcript}'")
        return transcript.strip()
        
    except Exception as e:
        print(f"❌ Error during Google Cloud Speech transcription: {e}")
        return "Error during transcription."


# Example self-test (optional)
if __name__ == "__main__":
    try:
        initialize_stt()
        print("Google Cloud Speech-to-Text initialized successfully.")
        
        # Test with actual audio file if available
        test_audio_file = "stt_test_input.wav"
        if os.path.exists(test_audio_file):
            text = transcribe_audio(test_audio_file, language="es")
            print(f"Google Cloud Speech transcribed text: {text}")
        else:
            print("No test audio file found. Create 'stt_test_input.wav' for testing.")
            print("You can generate one using the tts_module or record your own audio.")
    except Exception as e:
        print(f"Error during STT testing: {e}")
        print("Make sure you have:")
        print("1. pip install google-cloud-speech")
        print("2. Set GOOGLE_APPLICATION_CREDENTIALS environment variable")
        print("3. Valid Google Cloud project with Speech-to-Text API enabled")