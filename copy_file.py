import os
import shutil

# Specify the target folder
target_folder = r"..\\Zero\\Excalidraw\Scripts\\"

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
        # Special handling for JavaScript files
        if file_name.endswith('.js'):
            # Change destination to add .md extension
            destination_file = destination_file + '.md'
            # Simply copy the file without modifying content
            shutil.copy(source_file, destination_file)
            print(f"Copied with renamed extension: {file_name} -> {os.path.basename(destination_file)}")
        else:
            # Regular file copying
            shutil.copy(source_file, destination_file)
            print(f"Copied: {file_name}")

print("All files (excluding this script) copied successfully!")
