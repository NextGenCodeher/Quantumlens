document.addEventListener('DOMContentLoaded', function() {

    // =========================================================
    // 1. DYNAMIC TYPING EFFECT
    // =========================================================
    const words = [
	"Bloch Sphere Architect",
        "State Visualization",
	"Probability Mapper",
    	"QASM Logic Lab"
    ];

    let wordIndex = 0;
    let charIndex = 0;
    let isDeleting = false;
    const textElement = document.getElementById('typing-text');
    
    // Ensure the text element exists before running the loop
    if (textElement) {
        textElement.innerHTML = ''; // Clear initial content
        type();
    }

    function type() {
        const currentWord = words[wordIndex];
        
        // Determine the text to display based on deleting or typing state
        if (isDeleting) {
            textElement.textContent = currentWord.substring(0, charIndex - 1);
            charIndex--;
        } else {
            textElement.textContent = currentWord.substring(0, charIndex + 1);
            charIndex++;
        }

        // Logic for timing and switching words
        if (!isDeleting && charIndex === currentWord.length) {
            // Finished typing word, pause before deleting
            isDeleting = true;
            setTimeout(type, 2000); // Long pause after word is complete
        } else if (isDeleting && charIndex === 0) {
            // Finished deleting, switch to next word
            isDeleting = false;
            wordIndex = (wordIndex + 1) % words.length;
            setTimeout(type, 500); // Short pause before starting next word
        } else {
            // Continue typing or deleting (typing is slower than deleting)
            const speed = isDeleting ? 75 : 150; // Faster deleting speed
            setTimeout(type, speed);
        }
    }


    // ===================================
    // 2. FAQ ACCORDION SCRIPT (Interactive Collapse)
    // ===================================
    const faqItems = document.querySelectorAll('.faq-item');

    faqItems.forEach(item => {
        const question = item.querySelector('.faq-question');
        
        question.addEventListener('click', () => {
            // Check if the clicked item is already active
            const wasActive = item.classList.contains('active');

            // Close all other open items
            faqItems.forEach(otherItem => {
                otherItem.classList.remove('active');
            });

            // Toggle the 'active' class on the clicked item
            if (!wasActive) {
                item.classList.add('active');
            }
        });
    });

});