import os
import shutil

# Specify the target folder
target_folder = r"..\\iCloudDrive\\iCloud~md~obsidian\\Codeplay\\Excalidraw\Scripts\\"

# Ensure the target folder exists
if not os.path.exists(target_folder):
    os.makedirs(target_folder)

# Get the current folder
current_folder = os.getcwd()

# Get the name of this script
this_script = os.path.basename(__file__)

# Copy all files in the current folder to the target folder, excluding this script
for file_name in os.listdir(current_folder):
    source_file = os.path.join(current_folder, file_name)
    destination_file = os.path.join(target_folder, file_name)
    
    # Check if it is a file and not this script
    if os.path.isfile(source_file) and file_name != this_script:
        shutil.copy(source_file, destination_file)
        print(f"Copied: {file_name}")

print("All files (excluding this script) copied successfully!")
