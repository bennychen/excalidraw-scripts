import os
import shutil

# Specify the target folder
target_folder = r"..\\iCloudDrive\\iCloud~md~obsidian\\Codeplay\\Excalidraw\Scripts"

# Ensure the target folder exists
if not os.path.exists(target_folder):
    print("Target folder does not exist. Exiting.")
    exit()

# Get the current folder
current_folder = os.getcwd()

# Copy all files in the current folder to the target folder
for file_name in os.listdir(current_folder):
    source_file = os.path.join(current_folder, file_name)
    destination_file = os.path.join(target_folder, file_name)
    
    # Check if it is a file
    if os.path.isfile(source_file):
        shutil.copy(source_file, destination_file)
        print(f"Copied: {file_name}")

print("All files copied successfully!")
