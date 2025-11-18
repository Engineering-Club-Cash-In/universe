import asyncio
# import json # Removed if not used elsewhere
# import os # Removed if not used elsewhere
# from typing import List # Removed if not used elsewhere
# from crawl4ai import AsyncWebCrawler, BrowserConfig, CacheMode, CrawlerRunConfig, LLMConfig # Removed crawl4ai imports
# from crawl4ai.extraction_strategy import LLMExtractionStrategy # Removed crawl4ai imports
from playwright.async_api import async_playwright # Import async_playwright
from pydantic import BaseModel, Field

url_to_register = "https://www.facebook.com/r.php?entry_point=login"
# instruction_to_register = "create a new facebook account, use gncggznxdykkewhqap@poplk.com as the email and password " # No longer needed for playwright
base_url_to_scrape = "https://www.facebook.com/marketplace/guatemalacity/search?query="
instruction_to_scrape = "scrape all the listings on the page that have price higher than 1000"

# Using the provided email
registration_email = "xlcbfyhpnwvbekvkdy@nbmbb.com"
registration_password = "AStrongPassword123!" # Choose a strong password
first_name = "Jose"
last_name = "Garcia"
birth_day = "15"
birth_month = "6" # June (value corresponds to month number)
birth_year = "1995"

class Listing(BaseModel):
    title: str = Field(description="the title of the listing")
    price: int = Field(description="the price of the listing")
    description: str = Field(description="the description of the listing")
    image_url: str = Field(description="the image url of the listing")
    url: str = Field(description="the url of the listing")
    location: str = Field(description="the location of the listing")
    
async def create_new_facebook_account():
    # Use async playwright to interact with the registration page
    async with async_playwright() as p:
        # Consider adding user data dir for session persistence if needed later
        # context = await p.chromium.launch_persistent_context(user_data_dir="./fb_user_data", headless=False)
        # page = await context.new_page() 
        browser = await p.chromium.launch(headless=False) # Launch browser
        page = await browser.new_page() # Create new page
        try:
            print(f"Navigating to registration page: {url_to_register}")
            await page.goto(url_to_register, wait_until='networkidle') # Wait for page to load

            print("Filling registration form...")
            # Fill Name
            await page.fill('input[name="firstname"]', first_name)
            await page.fill('input[name="lastname"]', last_name)
            print(f"Filled name: {first_name} {last_name}")

            # Fill Email
            await page.fill('input[name="reg_email__"]', registration_email)
            print(f"Filled email: {registration_email}")
            
            # Re-enter Email if required (Facebook might ask for confirmation)
            # Check if the confirmation field is visible before filling
            email_confirmation_selector = 'input[name="reg_email_confirmation__"]'
            if await page.is_visible(email_confirmation_selector):
                 print("Filling email confirmation...")
                 await page.fill(email_confirmation_selector, registration_email)

            # Fill Password
            await page.fill('input[name="reg_passwd__"]', registration_password)
            print("Filled password.")

            # Fill Birthday
            await page.select_option('select#day', value=birth_day)
            await page.select_option('select#month', value=birth_month)
            await page.select_option('select#year', value=birth_year)
            print(f"Filled birthday: {birth_day}/{birth_month}/{birth_year}")

            # Select Gender (Male in this case)
            await page.check('input[name="sex"][value="2"]')
            print("Selected gender.")
            
            # Click Sign Up button
            print("Clicking Sign Up button...")
            await page.click('button[name="websubmit"]')

            # Optional: Add waits to check for confirmation elements or navigation
            # For example, wait for potential CAPTCHA or success page
            # await page.wait_for_timeout(5000) # Simple wait to observe
            print("Registration form submitted.")
            
            # Add logic here to determine if registration was successful
            # e.g., check URL, look for specific elements, handle CAPTCHAs
            
            # Return True if successful (example)
            # return True 

        except Exception as e:
            print(f"An error occurred during account creation: {e}")
            # return False # Indicate failure
        finally:
            print("Waiting briefly before closing browser...")
            await page.wait_for_timeout(5000) # Keep browser open for 5 seconds to see result
            await browser.close() # Ensure browser is closed
            print("Browser closed.")
    
    # Return None for now, or True/False based on success checks
    return None

async def main():
    print("Attempting to create Facebook account...")
    created_status = await create_new_facebook_account()
    if created_status is None: # Adjust based on return value
        print("Account creation function finished.")
    # else:
    #    print(f"Account creation status: {created_status}")


if __name__ == "__main__":
    asyncio.run(main())

