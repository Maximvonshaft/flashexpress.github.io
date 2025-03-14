function addTask() {
    let taskInput = document.getElementById("taskInput");
    let taskText = taskInput.value.trim();

    if (taskText === "") return; // Prevent empty tasks

    let taskList = document.getElementById("taskList");

    let li = document.createElement("li");
    li.innerHTML = `
        <span onclick="toggleTask(this)">${taskText}</span>
        <button onclick="removeTask(this)">❌</button>
    `;

    taskList.appendChild(li);
    taskInput.value = ""; // Clear input
}

function toggleTask(task) {
    task.classList.toggle("completed");
}

function removeTask(taskButton) {
    taskButton.parentElement.remove();
}
function openTask(taskName) {
    alert(`Opening task: ${taskName}`);
    // This can be updated to open a modal or a separate page
}
