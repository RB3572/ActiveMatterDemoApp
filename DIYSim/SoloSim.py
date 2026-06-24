from concurrent.futures import ThreadPoolExecutor
import tifffile as tiff
import tifffile as tif
import numpy as np
import os
from tqdm import tqdm
from PIL import Image
import cv2
from scipy.ndimage import binary_dilation
import tifffile as tiff
from contextlib import contextmanager
import os as _os
try:
    from DIYSim.SoloSim import run_sim as diy_run_sim
except Exception:
    diy_run_sim = None

@contextmanager
def _chdir(path):
    prev = _os.getcwd()
    _os.chdir(str(path))
    try:
        yield
    finally:
        _os.chdir(prev)
def update_mass_dynamics_with_threshold_noslip(arrays, dt, damping=0.99, resis=8, max_length=np.inf, noise=0.1, noslipboundary=None):
    """
    Update the dynamics of the mass-spring system using preallocated arrays,
    with a threshold to remove springs exceeding a specified length and a no-slip boundary.

    Parameters:
        arrays (dict): Dictionary containing preallocated arrays.
        dt (float): Time step for the simulation.
        damping (float): Damping factor for velocity.
        resis (float): Resistance coefficient.
        max_length (float): Maximum allowed length for a spring. Springs exceeding
                            this length will be removed (default: np.inf).
        noslipboundary (2D array, optional): Binary image indicating no-slip boundary regions.

    Returns:
        numpy.ndarray: Updated spring indices.
    """
    # Extract preallocated arrays
    positions = arrays["positions"]
    velocities = arrays["velocities"]
    accelerations = arrays["accelerations"]
    masses_array = arrays["masses_array"]
    spring_indices = arrays["spring_indices"]
    spring_constants = arrays["spring_constants"]
    spring_rest_lengths = arrays["spring_rest_lengths"]
    
    # Reset accelerations
    accelerations.fill(0)

    # Compute pairwise displacements for all springs
    displacements = positions[spring_indices[:, 1]] - positions[spring_indices[:, 0]]
    distances = np.linalg.norm(displacements, axis=1)

    # Filter springs by length threshold
    valid_springs_mask = distances <= max_length
    spring_indices = spring_indices[valid_springs_mask]
    spring_constants = spring_constants[valid_springs_mask]
    spring_rest_lengths = spring_rest_lengths[valid_springs_mask]
    displacements = displacements[valid_springs_mask]
    distances = distances[valid_springs_mask]

    # Normalize directions
    directions = displacements / (distances[:, None] + 1e-8)  # Avoid division by zero

    # Compute spring forces
    force_magnitudes = spring_constants * (distances - spring_rest_lengths)
    forces = directions * force_magnitudes[:, None]

    # Accumulate forces into accelerations
    np.add.at(accelerations, spring_indices[:, 0], forces / masses_array[spring_indices[:, 0], None])
    np.add.at(accelerations, spring_indices[:, 1], -forces / masses_array[spring_indices[:, 1], None])

    # Apply resistance
    resistance = -resis * velocities
    accelerations += resistance / masses_array[:, None]

    # Map positions to the noslipboundary mask if provided
    if noslipboundary is not None:
        noslipboundary = noslipboundary>0
        mask_height, mask_width = noslipboundary.shape

        # Normalize positions to mask dimensions
        x_indices = ((positions[:, 0] + mask_width // 2) % mask_width).astype(int)
        y_indices = ((positions[:, 1] + mask_height // 2) % mask_height).astype(int)

        # Check if positions fall within the no-slip region
        noslip_mask = noslipboundary[y_indices, x_indices]
    else:
        noslip_mask = np.zeros(len(positions), dtype=bool)

    # Update velocities and positions only for masses not in the no-slip region
    spring_noise = np.random.normal(loc=0, scale=noise, size=positions.shape)
    
    free_masses = ~noslip_mask
    velocities[free_masses] *= damping
    velocities[free_masses] += accelerations[free_masses] * dt
    positions[free_masses] += velocities[free_masses] * dt
    positions +=spring_noise
    
    # Update arrays in-place
    arrays["positions"] = positions
    arrays["velocities"] = velocities
    arrays["accelerations"] = accelerations
    arrays["spring_indices"] = spring_indices
    arrays["spring_constants"] = spring_constants
    arrays["spring_rest_lengths"] = spring_rest_lengths
    return spring_indices

def activate_springs_from_mask_only(
    t, arrays, binary_mask, new_spring_constant = 1.1305, new_rest_length=0,default_spring_constant=480.295, bdrate=0.08545 , cdrate = -0.008405,  method = "sigmoidal"):
    """
    Modify spring constants and rest lengths in the arrays based on a binary mask, using mass positions.

    Parameters:
        arrays (dict): Dictionary containing preallocated arrays for the mass-spring system.
        binary_mask (2D array): Binary mask indicating which regions activate the springs.
        new_spring_constant (float): New spring constant for activated springs.
        new_rest_length (float): New rest length for activated springs (default: 0).

    Returns:
        None: Modifies the arrays in place.
    """
    positions = arrays["positions"]
    spring_indices = arrays["spring_indices"]
    spring_constants = arrays["spring_constants"]
    spring_rest_lengths = arrays["spring_rest_lengths"]

    # Normalize positions to the binary mask coordinates
    height, width = binary_mask.shape
    normalized_positions = (positions - positions.min(axis=0)) / (
        positions.max(axis=0) - positions.min(axis=0)
    )
    normalized_positions[:, 0] *= width - 1
    normalized_positions[:, 1] *= height - 1

    # Identify which bin each mass belongs to in the binary mask
    mass1_positions = normalized_positions[spring_indices[:, 0]].astype(int)
    mass2_positions = normalized_positions[spring_indices[:, 1]].astype(int)

    # Check if each mass is in the activated region
    mass1_mask = binary_mask[mass1_positions[:, 1], mass1_positions[:, 0]]
    mass2_mask = binary_mask[mass2_positions[:, 1], mass2_positions[:, 0]]
    
    # Identify springs to activate
    activated_springs = mass1_mask | mass2_mask  # Logical OR to find affected springs
    #activated_springs = mass1_mask & mass2_mask  # Logical AND to find affected springs
    activated_springs = activated_springs>0
    #print(np.count_nonzero(activated_springs))


    if method == "exponential":
        spring_constants[activated_springs] = default_spring_constant + (new_spring_constant - default_spring_constant) * (1 - np.exp(-bdrate * t))
    elif method == "linear":
        delta = bdrate * (new_spring_constant - spring_constants[activated_springs])
        spring_constants[activated_springs] += delta
    elif method == "sigmoidal":
        a = new_spring_constant #1.1305 #new_spring_constant
        b = bdrate
        c = cdrate
        d = default_spring_constant #480.295 # default_spring_constant
        R = a / (1 + np.exp(-c * (t - d))) + b
        spring_constants[activated_springs] = default_spring_constant + (new_spring_constant - default_spring_constant) * R
    else:
        spring_constants[activated_springs] = new_spring_constant

    spring_rest_lengths[activated_springs] = new_rest_length
    
    
    #print(spring_noise.shape)
    #spring_rest_lengths = spring_rest_lengths*spring_noise
    #print(np.count_nonzero(activated_springs))
    # Update the arrays in place
    arrays["spring_constants"] = spring_constants
    arrays["spring_rest_lengths"] = spring_rest_lengths

def remove_masses_and_springs_under_mask(arrays, mask):
    """
    Remove all masses and their corresponding springs under a mask.

    Parameters:
        arrays (dict): Preallocated arrays from initialize_mass_spring_arrays.
        mask (2D array): Binary mask indicating the region to remove masses and springs.

    Returns:
        dict: Updated arrays with masses and springs removed.
    """
    # Extract arrays
    positions = arrays["positions"]
    velocities = arrays["velocities"]
    accelerations = arrays["accelerations"]
    masses_array = arrays["masses_array"]
    spring_indices = arrays["spring_indices"]
    spring_constants = arrays["spring_constants"]
    spring_rest_lengths = arrays["spring_rest_lengths"]

    # Identify masses covered by the mask
    mask_shape = mask.shape
    covered_masses = []
    for i, (x, y) in enumerate(positions):
        # Find the mask indices corresponding to the mass position
        mask_x_idx = int((x + mask_shape[1] // 2))  # Adjust for array indexing
        mask_y_idx = int((y + mask_shape[0] // 2))
        mask_x_idx = max(min(mask_x_idx,mask.shape[1]-1), 0)
        mask_y_idx = max(min(mask_y_idx,mask.shape[0]-1), 0)
        if mask[mask_y_idx, mask_x_idx]:
            covered_masses.append(i)

    covered_masses = np.array(covered_masses)

    # Create a mask for masses not covered
    not_covered_mask = ~np.isin(np.arange(len(positions)), covered_masses)

    # Filter masses
    positions = positions[not_covered_mask]
    velocities = velocities[not_covered_mask]
    accelerations = accelerations[not_covered_mask]
    masses_array = masses_array[not_covered_mask]

    # Create a mask for springs not connected to removed masses
    not_covered_spring_mask = ~np.any(np.isin(spring_indices, covered_masses), axis=1)

    # Filter springs
    spring_indices = spring_indices[not_covered_spring_mask]
    spring_constants = spring_constants[not_covered_spring_mask]
    spring_rest_lengths = spring_rest_lengths[not_covered_spring_mask]

    # Adjust spring indices to reflect removed masses
    mapping = np.full(len(arrays["positions"]), -1, dtype=int)
    mapping[np.where(not_covered_mask)[0]] = np.arange(len(positions))
    spring_indices = np.vectorize(lambda x: mapping[x])(spring_indices)

    # Update arrays
    arrays["positions"] = positions
    arrays["velocities"] = velocities
    arrays["accelerations"] = accelerations
    arrays["masses_array"] = masses_array
    arrays["spring_indices"] = spring_indices
    arrays["spring_constants"] = spring_constants
    arrays["spring_rest_lengths"] = spring_rest_lengths

    return arrays
def get_light_pattern(proj_pattern, frame=None):
    factor4x = 2.825
    factor4y = 2.825
    x_lim = 2048/factor4x
    lx = int(1280*factor4x)
    ly = int(800*factor4y)
    shift_x =0
    shift_y =0
    
    center_size = 2048
    start_x = (ly - center_size) // 2 + shift_x
    end_x = start_x + center_size
    start_y = (lx - center_size) // 2 + shift_y
    end_y = start_y + center_size
    if frame==None:
        light_p = proj_pattern
    else:
        light_p = proj_pattern[frame]
    light_p = np.flip(np.array(light_p),axis=0)
    resized_light_p= cv2.resize(light_p, (lx,ly), interpolation=cv2.INTER_LINEAR)
    chop_p = resized_light_p[start_x:end_x, start_y:end_y]
    chop_p[chop_p>0]=1
    
    target_height = 3000
    target_width = 3000
    pad_height = (target_height - chop_p.shape[0]) // 2
    pad_width = (target_width - chop_p.shape[1]) // 2
    
    result = np.pad(chop_p, ((pad_height, pad_height), (pad_width, pad_width)), mode='constant', constant_values=0)
    return result

def load_grid(name):
    array_n =name+'.npz' 
    filename = name+'.txt' 
    
    # Load the arrays dictionary
    data = np.load(array_n, allow_pickle=True)
    
    # Recreate the arrays dictionary
    arrays = {
        "positions": data["positions"],
        "velocities": data["velocities"],
        "accelerations": data["accelerations"],
        "masses_array": data["masses_array"],
        "spring_indices": data["spring_indices"],
        "spring_constants": data["spring_constants"],
        "spring_rest_lengths": data["spring_rest_lengths"]
    }
    
    parameters = {}
    with open(filename, 'r') as f:
        for line in f:
            # Skip header lines
            if ":" in line:
                key, value = line.split(":")
                parameters[key.strip()] = float(value.strip()) if '.' in value or 'e' in value.lower() else int(value.strip())
    space_size = parameters['space_size']
    threshold_distance = parameters['threshold_distance']
    spring_constant = parameters['spring_constant']
    mass_value = parameters['mass_value']
    min_distance = parameters['min_distance']
    initial_v = parameters['initial_v']
    return arrays, space_size, threshold_distance, spring_constant, mass_value, min_distance, initial_v
def load_run(name):
    filename = name+'.txt' 
    # Load the arrays dictionary
    parameters = {}
    with open(filename, 'r') as f:
        for line in f:
            # Skip header lines
            if ":" in line:
                #print(line)
                key, value = line.split(":")
                if '.tiff' in value:
                    parameters[key.strip()] = str(value)
                    continue
                if '_' in value:
                    parameters[key.strip()] = value.strip()
                    continue
                parameters[key.strip()] = float(value.strip()) if '.' in value or 'e' in value.lower() else int(value.strip())
    grid_name = parameters['grid_name']
    num_steps = parameters['num_steps']
    dt = parameters['dt']
    activated_rest_length = parameters['activated_rest_length']
    bdrate = parameters['bdrate']
    cdrate = parameters['cdrate']
    activated_spring_constant = parameters['activated_spring_constant']
    max_length = parameters['max_length']
    damping = parameters['damping']
    resis = parameters['resis'] 
    noise = parameters['noise'] 
    light_pattern = parameters['light_pattern']
    #no_slip_region = parameters['no_slip_region']
    binary_microfluidic_mask = parameters['binary_microfluidic_mask']
    return grid_name,num_steps,dt,activated_rest_length,bdrate,activated_spring_constant,max_length,damping,resis,noise,light_pattern,binary_microfluidic_mask
# Function to plot 4 frames
import numpy as np
import matplotlib.pyplot as plt
from tifffile import imsave  # To save frames as .tif images
from matplotlib.colors import LogNorm
from mpl_toolkits.axes_grid1 import make_axes_locatable
def plot_frame_with_density(frame_idx, positions, mask, noslipboundary= None, output_dir=None, x_range=(-10, 10), y_range=(-10, 10), bins=1000, cmap='bwr'):
    """
    Plot a specific frame of the mass-spring simulation with a density heatmap and mask using matplotlib.

    Parameters:
        frame_idx (int): Index of the frame to plot.
        positions (list): A list of lists containing mass positions for each frame.
        masses (list): A list of Mass objects.
        springs (list): A list of Spring objects.
        mask (2D array): A binary array representing the active regions of the mask.
        output_dir (str): Directory to save the frame as a .tif file. If None, the frame is not saved.
        x_range (tuple): Range for the x-axis (default: (-10, 10)).
        y_range (tuple): Range for the y-axis (default: (-10, 10)).
        bins (int): Number of bins for the 2D histogram to calculate density (default: 50).
        cmap (str): Colormap for the density heatmap (default: 'viridis').
    """
    # Get the positions for the specified frame
    current_positions = positions[frame_idx]
    mass_x = [pos[0] for pos in current_positions]
    mass_y = [pos[1] for pos in current_positions]


    # Compute 2D density
    heatmap, xedges, yedges = np.histogram2d(mass_x, mass_y, bins=bins, range=[x_range, y_range], density=True)
    ref = np.average(heatmap[0:50, 0:50])
    if ref <= 0 or np.isnan(ref):
        ref = np.max(heatmap) / 10  # or set a small default like 1e-5
        if ref <= 0 or np.isnan(ref):
            ref = 1e-5  # final fallback to avoid log(0)

    # Plot using matplotlib
    fig, ax = plt.subplots(figsize=(8, 8))
    plt.axis('off')
    divider = make_axes_locatable(ax)
    cax = divider.append_axes('right', size='5%', pad=0.05)
    # Plot density heatmap
    img = ax.imshow(
        heatmap.T, 
        extent=[xedges[0], xedges[-1], yedges[0], yedges[-1]],
        origin='lower', 
        cmap=cmap, 
        alpha=0.9, 
        aspect='auto',
        norm=LogNorm(vmin=ref/5, vmax=ref*10)
    )
    cbar = fig.colorbar(img, fraction=0.046, pad=0.04, cax=cax)# Fixed color bar
    # Adjust color bar labels
    cbar.set_label("MT concentration ratio", fontsize=12)
    custom_ticks = np.linspace(ref/5,ref*10,8)
    cbar.set_ticks(custom_ticks)
    cbar.set_ticklabels([f'{tick/ref:.2f}' for tick in custom_ticks])
    # Overlay the mask
    ax.imshow(np.flip(np.array(mask),axis=0), extent=[x_range[0], x_range[1], y_range[0], y_range[1]], 
              cmap="summer", alpha=0.2, interpolation="nearest", aspect="auto")

    if noslipboundary is not None:
        ax.imshow(
        noslipboundary, 
        extent=[x_range[0], x_range[1], y_range[0], y_range[1]], 
        origin="lower", 
        cmap="Grays", 
        alpha=0.5, 
        interpolation="nearest", 
        aspect="auto"
    )
    # Overlay masses
    #ax.scatter(mass_x, mass_y, s=5, color="white", alpha=0.8, label="Masses")
    
    # Customize plot
    ax.set_xlim(x_range)
    ax.set_ylim(y_range)
    ax.set_xlabel("X Position")
    ax.set_ylabel("Y Position")
    ax.set_title(f"Mass-Spring System with Density Heatmap: Frame {frame_idx}")
    ax.set_aspect('equal')
    #plt.legend()
    #plt.grid(False)
    #plt.show()

    # Save the plot as a .tif image if output_dir is provided
    if output_dir:
        file_path = f"{output_dir}/frame_{frame_idx:04d}.tif"
        fig.canvas.draw()  # Render the plot
        fig.canvas.draw()
        image = np.frombuffer(fig.canvas.tostring_rgb(), dtype=np.uint8)
        image = image.reshape(fig.canvas.get_width_height()[::-1] + (3,))
        imsave(file_path, image)
        print(f"Frame {frame_idx} saved to {file_path}")
    fig.canvas.draw()
    image = np.frombuffer(fig.canvas.buffer_rgba(), dtype=np.uint8)
    image = image.reshape(fig.canvas.get_width_height()[::-1] + (4,))
    plt.close(fig)
    return image
    
def plot_multiple_frames(frame_indices, positions_over_time, binary_mask, noslipboundary, x_range, y_range,f_name):
    """
    Plot multiple frames of the mass-spring system with masks.

    Parameters:
        frame_indices (list): List of frame indices to plot.
        positions_over_time (list): List of positions at each frame.
        springs (list): List of springs.
        spring_masks (list): List of spring masks for each frame.
        binary_mask (2D array): Activation mask.
        noslipboundary (2D array): No-slip boundary mask.
        x_range (tuple): Range for x-axis.
        y_range (tuple): Range for y-axis.
    """
    fig, axes = plt.subplots(3, 3, figsize=(10, 10))  # 2x2 grid for 4 frames

    for ax, frame_idx in zip(axes.flatten(), frame_indices):
        # Generate the image for the current frame
        im = plot_frame_with_density(
            frame_idx,
            positions_over_time,
            binary_mask,
            noslipboundary=noslipboundary,
            x_range=x_range,
            y_range=y_range,
            output_dir=None
        )

        # Display the image
        ax.imshow(im)
        ax.set_title(f"Frame {frame_idx}")
        ax.axis('off')  # Hide axes for better visualization

    plt.tight_layout()
    plt.savefig(f_name)

#binary mask one
def run_sim(parm):
    # Load parameters
    (grid_name, num_steps, dt, activated_rest_length, bdrate,
     activated_spring_constant, max_length, damping, resis, noise,
     light_pattern, binary_microfluidic_mask) = load_run(parm)

    arrays, space_size, threshold_distance, spring_constant, mass_value, min_distance, initial_v = load_grid(grid_name)

    print(f"Light Pattern: {light_pattern}")
    base_path = ""
    p_name = os.path.join(base_path, light_pattern.strip())
    proj_pattern = tiff.imread(p_name)
    num_frames = proj_pattern.shape[0] if proj_pattern.ndim > 2 else 1
    print(f"Length of Light Pattern Stacked Tiff: {num_frames}")

    chop_p = get_light_pattern(proj_pattern)
    binary_mask = cv2.resize(chop_p, (space_size, space_size), interpolation=cv2.INTER_LINEAR)
    print(f"Dimensions of the Entire Frame: {space_size}")  # probably 3000

    activated_spring_constant = spring_constant * activated_spring_constant
    max_length = threshold_distance * max_length
    default_rest_length = np.average(arrays['spring_rest_lengths'])

    t1 = os.path.join("")
    print(f"Gel Vector: {binary_microfluidic_mask}")
    file_path = os.path.join(t1, binary_microfluidic_mask)

    # Load and process microfluidic mask
    image = Image.open(file_path.strip()).convert('L')
    binary_image = np.array(image) < 128
    resized_binary_image = Image.fromarray(binary_image.astype('uint8') * 255).resize((1280, 800), Image.NEAREST)
    canvas = get_light_pattern(resized_binary_image)
    binary_microfluidic_mask = canvas
    no_slip_region = binary_dilation(binary_microfluidic_mask, iterations=3)
    arrays = remove_masses_and_springs_under_mask(arrays, no_slip_region)

    print('Start simulation')
    positions_over_time = []

    # Simulation loop
    for step in tqdm(range(num_steps), desc="Simulating Mass-Spring Network"):
        frame_idx = step % num_frames
        chop_p = get_light_pattern(proj_pattern)
        binary_mask = cv2.resize(chop_p, (space_size, space_size), interpolation=cv2.INTER_LINEAR)

        activate_springs_from_mask_only(
            step, arrays, binary_mask,
            new_spring_constant=activated_spring_constant,
            new_rest_length=activated_rest_length,
            default_spring_constant=spring_constant,
            bdrate=bdrate, method='exp'
        )

        update_mass_dynamics_with_threshold_noslip(
            arrays, dt=dt, damping=damping, resis=resis,
            max_length=max_length, noise=noise,
            noslipboundary=no_slip_region
        )

        positions_over_time.append(arrays["positions"].copy())

    # Plot sample frames to PNG
    frame_indices = np.arange(10, num_steps, max(1, (num_steps - 10) // 8)).astype(int)
    img_dir = os.path.join(os.getcwd(), parm + '.png')
    plot_multiple_frames(
        frame_indices,
        positions_over_time,
        binary_mask,
        noslipboundary=binary_microfluidic_mask,
        x_range=(-1500, 1500),
        y_range=(-1500, 1500),
        f_name=img_dir
    )

    # --- Save stacked TIFF ---
    def generate_frame_point_local(frame_idx):
        return plot_frame_with_density(
            frame_idx,
            positions_over_time,
            binary_mask,
            noslipboundary=binary_microfluidic_mask,
            output_dir=None,
            x_range=(-1500, 1500),
            y_range=(-1500, 1500)
        )

    output_file = os.path.join(os.getcwd(), parm + '.tiff')
    os.makedirs(os.path.dirname(output_file), exist_ok=True)

    d_save = 10
    n_frames = len(positions_over_time)
    n_save = np.arange(0, n_frames, d_save, dtype=int)
    if n_save[-1] != n_frames - 1:
        n_save = np.append(n_save, n_frames - 1)

    with ThreadPoolExecutor() as executor:
        frames = list(tqdm(executor.map(generate_frame_point_local, n_save), total=len(n_save)))

    tif.imwrite(output_file, np.array(frames), photometric='rgb')
    print(f"Stacked TIFF saved to {output_file}")

run_sim('DIYSimParm')