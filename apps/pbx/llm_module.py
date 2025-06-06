# llm_module.py
from openai import OpenAI
import time
import re

client = None
provider = None
model_name = None

def clean_text_for_tts(text):
    """
    Cleans text by removing markdown formatting for better TTS pronunciation.
    """
    if not text:
        return text
    
    # Remove common markdown formatting
    cleaned = text
    
    # Remove bold (**text** or __text__)
    cleaned = re.sub(r'\*\*(.*?)\*\*', r'\1', cleaned)
    cleaned = re.sub(r'__(.*?)__', r'\1', cleaned)
    
    # Remove italic (*text* or _text_)
    cleaned = re.sub(r'\*(.*?)\*', r'\1', cleaned)
    cleaned = re.sub(r'_(.*?)_', r'\1', cleaned)
    
    # Remove headers (# ## ###)
    cleaned = re.sub(r'^#{1,6}\s*', '', cleaned, flags=re.MULTILINE)
    
    # Remove code blocks (```text```)
    cleaned = re.sub(r'```.*?```', '', cleaned, flags=re.DOTALL)
    
    # Remove inline code (`text`)
    cleaned = re.sub(r'`(.*?)`', r'\1', cleaned)
    
    # Remove links [text](url)
    cleaned = re.sub(r'\[([^\]]+)\]\([^\)]+\)', r'\1', cleaned)
    
    # Remove remaining brackets and parentheses that might be markdown remnants
    cleaned = re.sub(r'[\[\]()]', '', cleaned)
    
    # Clean up extra spaces
    cleaned = re.sub(r'\s+', ' ', cleaned).strip()
    
    return cleaned

def initialize_llm(api_key, use_openai=False, openai_api_key=None):
    """Initializes the LLM client (Deepseek or OpenAI)."""
    global client, provider, model_name
    
    if use_openai:
        if not openai_api_key or openai_api_key == "YOUR_OPENAI_API_KEY_HERE":
            # In a production app, you might raise an error or log a warning
            print("WARNING: OpenAI API key is a placeholder or missing. LLM (OpenAI) may not function.")
            # For robustness, we can allow it to proceed if some other part of the app might not use LLM.
            # However, if LLM is critical, raising an error is better:
            # raise ValueError("OpenAI API key is required when use_openai=True.")
        
        client = OpenAI(
            api_key=openai_api_key,
            timeout=30.0
        )
        provider = "openai"
        model_name = "gpt-4o-mini" # Or your preferred OpenAI model
        print("OpenAI LLM initialized (Model: gpt-4o-mini).")
    else:
        if not api_key or api_key == "YOUR_DEEPSEEK_API_KEY_HERE":
            print("WARNING: Deepseek API key is a placeholder or missing. LLM (Deepseek) may not function.")
            # raise ValueError("Deepseek API key is required and should not be the placeholder.")
        
        client = OpenAI(
            api_key=api_key, 
            base_url="https://api.deepseek.com/v1",
            timeout=30.0
        )
        provider = "deepseek"
        model_name = "deepseek-chat" # Or "deepseek-coder"
        print(f"Deepseek LLM initialized (Model: {model_name}).")

def get_ai_response(prompt, conversation_history=None):
    """
    Gets a streaming response from the configured AI provider.
    Yields text chunks as they are received.
    """
    if client is None:
        print("LLM client not available. Returning empty stream.")
        # Depending on strictness, could raise Exception("LLM not initialized...")
        yield "" # Return an empty generator if not initialized
        return

    api_start_time = time.time()
    
    # System message to ensure clean text output for TTS
    system_message = {
        "role": "system", 
        "content": "Eres un asistente de IA conversacional. Responde SIEMPRE en español y SOLO en texto plano. NO uses markdown, asteriscos (*), hashtags (#), corchetes, ni ningún símbolo de formato. Tu respuesta será convertida a voz, así que debe sonar natural cuando se lea en voz alta. Sé conciso, claro y directo."
    }
    
    messages = [system_message]
    if conversation_history:
        recent_history = conversation_history[-3:]
        for entry in recent_history:
            if entry.get("user_message"):
                messages.append({"role": "user", "content": entry["user_message"]})
            if entry.get("ai_message"):
                messages.append({"role": "assistant", "content": entry["ai_message"]})
    messages.append({"role": "user", "content": prompt})
    
    provider_name = provider or "LLM"
    current_model_name = model_name or "default-model"
    print(f"🧠 Streaming request to {provider_name.upper()} (Model: {current_model_name}) with {len(messages)} messages...")

    try:
        if provider == "openai":
            max_tokens = 300
            temperature = 0.7
        else:  # deepseek
            max_tokens = 250 # Adjusted for potentially faster chunking
            temperature = 0.7

        response_stream = client.chat.completions.create(
            model=current_model_name,
            messages=messages,  # type: ignore
            max_tokens=max_tokens,
            temperature=temperature,
            stream=True, # Enable streaming
        )
        
        for chunk in response_stream:
            if hasattr(chunk.choices[0], 'delta') and chunk.choices[0].delta and chunk.choices[0].delta.content:
                content_chunk = chunk.choices[0].delta.content
                # Clean any remaining markdown formatting for TTS compatibility
                cleaned_chunk = clean_text_for_tts(content_chunk)
                if cleaned_chunk:  # Only yield non-empty chunks
                    yield cleaned_chunk
        
        api_time = time.time() - api_start_time
        print(f"🧠 {provider_name.upper()} stream finished in {api_time:.3f}s")
        
    except Exception as e:
        api_time = time.time() - api_start_time
        print(f"🧠 {provider_name.upper()} API stream error after {api_time:.3f}s: {e}")
        yield " Sorry, I encountered an error. " # Yield an error message within the stream