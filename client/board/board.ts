"use strict";

//@ts-ignore
const mode = import.meta.env.MODE || "production" // get vite mode, default to prod

import { io } from "socket.io-client"
import interact from "interactjs"
import Swal from "sweetalert2"
import { getUsername, isProtected, getBoard, createNote, updateNote, updateNotePos, updateNoteSize, deleteNote, getNote, checkPassword, logMessage, protect, updatePassword, setUsername, renameBoard } from "../actions"
import { el, textNode } from "../js/element"
import { Pos, Size } from "../types";
import { infoPopup, openPopup, protectPopup } from './popups'
// mock actions for dev environment
const { MODE, VITE_API_DEV_URL, VITE_API_URL } = import.meta.env;
let baseURL = MODE === "development" ? VITE_API_DEV_URL : VITE_API_URL;
const socket = io(baseURL)
const board_id = mode === "development" ?  sessionStorage.getItem("__dev_boardId") : window.location.href.split('/')[3]
console.log("What is", board_id)
const defaultPos = {left: 0, top: 0}
let username = null;

// helpers
const getBoardBounds = () => {
  const topMin = document.querySelector(".h-titles").clientHeight;
  const leftMin = document.querySelector(".v-titles").clientWidth;
  const topMax = document.querySelector(".q-container").clientHeight + topMin;
  const leftMax =
    document.querySelector(".q-container").clientWidth + leftMin;
  return { topMin, leftMin, topMax, leftMax };
};

const normalize = ({ x, y }) => {
  const { topMin, leftMin, topMax, leftMax } = getBoardBounds();
  const left = x * (leftMax - leftMin) + leftMin;
  const top = y * (topMax - topMin) + topMin;
  return { left, top };
};

let currentBounds = getBoardBounds()
console.log(currentBounds)

document.addEventListener("DOMContentLoaded", () => {
  const stickyArea = document.querySelector("#stickies-container");
  const createStickyButton = document.querySelector("#createsticky") as HTMLButtonElement;

  const stickyTitleInput = document.querySelector("#stickytitle") as HTMLInputElement;
  const stickyTextInput = document.querySelector("#stickytext") as HTMLTextAreaElement;

  getUsername().then(res => {
    username = res
    const input = document.querySelector(".name-input") as HTMLInputElement
    input.value = res
  })

  // socket.io functions
  const sendCreateNote = () => {
    // create a note and send it
    // here we have access to title and text field
    const title = stickyTitleInput.value;
    const text = stickyTextInput.value;
    const pos = { left: Math.random(), top: Math.random() };
    const note = { title, text, pos };
    createNote(board_id, note)
      .then((newNote) => {
        socket.emit("note created", { note: newNote, board_id, username });
        console.log('did socket emit???')
        createSticky(newNote._id, pos);
      })
      .catch((e) => console.log("an unknown error occurred"));
  };
  const sendUpdateNote = (_id, title, text) => {
    const note = { _id, title, text, tempQuadrant: defaultPos };
    updateNote(note)
      .then((resNote) => {
        socket.emit("note update", { note: resNote, board_id, username });
      })
      .catch((e) => console.log("an error occurred"));
  };
  const sendMoveNote = (note_id, pos) => {
    updateNotePos(note_id, pos)
      .then((_resPos) => {
        socket.emit("note move", { note_id, pos, board_id });
      })
      .catch((e) => console.error("an unknown error has occurred"));
  };
  const socketMoveNote = (note_id, pos) => {
    // send update to other users but not database
    socket.emit("note move", { note_id, pos, board_id });
  };
  const sendResizeNote = (note_id, size) => {
    updateNoteSize(note_id, size)
      .then((_resSize) => {
        socket.emit("note resize", { note_id, size, board_id });
      })
      .catch((e) => console.error("an unknown error occurred"));
  };
  const socketResizeNote = (note_id, size) => {
    // send update to other users but not database
    socket.emit("note resize", { note_id, size, board_id });
  };
  const sendDeleteNote = (note_id, title) => {
    deleteNote(note_id).then(note => {
      socket.emit('note delete', {note_id, board_id, username, title: note.title})
    })
  }

  interact(".sticky").resizable({
    edges: { top: false, left: false, bottom: true, right: true },
    listeners: {
      move: function (event) {
        Object.assign(event.target.style, {
          width: `${event.rect.width}px`,
          height: `${event.rect.height}px`,
        });

        const id = event.target.getAttribute("id");
        const size = { width: event.rect.width, height: event.rect.height };
        socketResizeNote(id, size);
      },
      end: function (event) {
        Object.assign(event.target.style, {
          width: `${event.rect.width}px`,
          height: `${event.rect.height}px`,
        });

        const id = event.target.getAttribute("id");
        const size = { width: event.rect.width, height: event.rect.height };
        sendResizeNote(id, size);
      },
    },
  });

  interact(".sticky").draggable({
    onmove(event) {
      const left = parseFloat(event.target.style.left) + event.dx;
      const top = parseFloat(event.target.style.top) + event.dy;
      event.target.style.left = `${left}px`;
      event.target.style.top = `${top}px`;

      const id = event.target.getAttribute("id");
      const { topMin, leftMin, topMax, leftMax } = getBoardBounds();
      // x is left 0to1, y is top 0to1
      const x = (left - leftMin) / (leftMax - leftMin);
      const y = (top - topMin) / (topMax - topMin);
      socketMoveNote(id, { left: x, top: y });
    },
    onend(event) {
      const left = parseFloat(event.target.style.left) + event.dx;
      const top = parseFloat(event.target.style.top) + event.dy;

      const id = event.target.getAttribute("id");
      const { topMin, leftMin, topMax, leftMax } = getBoardBounds();
      // x is left 0to1, y is top 0to1
      const x = (left - leftMin) / (leftMax - leftMin);
      const y = (top - topMin) / (topMax - topMin);
      sendMoveNote(id, { left: x, top: y });
    },
  });

  const receiveCreatedNote = ({ note, io_board_id }) => {
    if (io_board_id === board_id) {
      loadSticky(note._id, note.title, note.text, note.pos);
    }
  };
  const receiveUpdatedNote = ({ note, io_board_id }) => {
    if (io_board_id === board_id) {
      const noteEL = document.querySelector(`.sticky[id="${note._id}"]`);
      noteEL.querySelector("h3").innerText = note.title;
      noteEL.querySelector("p").innerText = note.text;
    }
  };
  const receiveMoveNote = ({ note_id, pos, io_board_id }) => {
    if (io_board_id === board_id) {
      const noteEl = document.querySelector(`.sticky[id="${note_id}"]`) as HTMLDivElement;
      const { left, top } = normalize({ x: pos.left, y: pos.top });
      noteEl.style.left = `${left}px`;
      noteEl.style.top = `${top}px`;
    }
  };
  const receiveResizeNote = ({ note_id, size, io_board_id }) => {
    if (io_board_id === board_id) {
      const noteEl = document.querySelector(`.sticky[id="${note_id}"]`) as HTMLDivElement;
      noteEl.style.width = `${size.width}px`;
      noteEl.style.height = `${size.height}px`;
    }
  };
  const receiveDeleteNote = ({ note_id, io_board_id }) => {
    if (io_board_id === board_id) {
      const el = document.querySelector(`.sticky[id="${note_id}"]`);
      el.parentElement.removeChild(el);
    }
  };

  socket.on("receive note", ({ note, io_board_id }) => {
    receiveCreatedNote({ note, io_board_id });
  });

  socket.on("receive update", ({ note, io_board_id }) => {
    receiveUpdatedNote({ note, io_board_id });
  });

  socket.on("receive move", ({ note_id, pos, io_board_id }) => {
    receiveMoveNote({ note_id, pos, io_board_id });
  });

  socket.on("receive resize", ({ note_id, size, io_board_id }) => {
    receiveResizeNote({ note_id, size, io_board_id });
  });

  socket.on("receive delete", ({ note_id, io_board_id }) => {
    receiveDeleteNote({ note_id, io_board_id });
  });

  socket.on('receive create log', ({io_board_id, username, title}) => {
    if (io_board_id === board_id) {
      newStickyLog(username, title)
    }
  })

  socket.on('receive update log', ({io_board_id, username, title}) => {
    if (io_board_id === board_id) {
      updateStickyLog(username, title)
    }
  })

  socket.on('receive delete log', ({io_board_id, username, title}) => {
    if (io_board_id === board_id) {
      deleteStickyLog(username, title)
    }
  })

  const deleteSticky = async e => {
    const id = e.target.parentElement.getAttribute('id')
    const title = (await getNote(id)).title || '[no title]'
    e.target.parentNode.remove();
    sendDeleteNote(id, title);
  };

  const editSticky = (e) => {
    const sticky = e.target.parentElement;
    const edith3 = document.createElement("input") as HTMLInputElement;
    edith3.classList.add(...[...sticky.querySelector("h3").classList]);
    edith3.classList.add("input-h3");
    edith3.value = sticky.querySelector("h3").innerText;
    const editp = document.createElement("textarea");
    editp.classList.add(...[...sticky.querySelector("p").classList]); // TODO ugly pls fix here and above
    editp.classList.add("input-p");
    editp.value = sticky.querySelector("p").innerText;
    sticky.querySelector("h3").remove();
    sticky.querySelector("p").remove();
    sticky.appendChild(edith3);
    sticky.appendChild(editp);
    sticky
      .querySelector(".editsticky")
      .removeEventListener("click", editSticky, false);
    sticky.querySelector(".editsticky").addEventListener("click", blurInputs);
    // sticky.querySelector('.editsticky').innerText = 'Update'
    sticky.querySelector(".editsticky").src = "../icons/check.png";
  };

  const blurInputs = async (e) => {
    const sticky = e.target.parentElement;
    // send updates
    const id = sticky.getAttribute("id");
    const title = sticky.querySelector(".input-h3").value;
    const text = sticky.querySelector(".input-p").value;
    try {
      await sendUpdateNote(id, title, text);
    } catch (e) {
      console.log("an error occured");
      return;
    } finally {
      // reset note
      const h3 = document.createElement("h3");
      h3.classList.add(...[...sticky.querySelector(".input-h3").classList]);
      h3.classList.remove("input-h3");
      h3.innerText = title;
      const p = document.createElement("p");
      p.classList.add(...[...sticky.querySelector(".input-p").classList]); // TODO ugly fix this too PLEASE
      p.classList.remove("input-p");
      p.innerText = text;
      sticky.querySelector(".input-h3").remove();
      sticky.querySelector(".input-p").remove();
      sticky.appendChild(h3);
      sticky.appendChild(p);
      sticky
        .querySelector(".editsticky")
        .removeEventListener("click", blurInputs, false);
      sticky.querySelector(".editsticky").addEventListener("click", editSticky);
      // sticky.querySelector('.editsticky').innerText = 'Edit'
      sticky.querySelector(".editsticky").src = "../icons/edit.png";
    }
  };

  function createSticky(note_id, pos) {
    const newSticky = el(
      'div',
      'drag sticky',
      {"id": note_id},
      el('h3', '', {}, textNode(stripHtml(stickyTitleInput.value))),
      el('p', '', {}, ...splitBr(stickyTextInput.value)),
      el('input', 'editsticky', {'type': 'image', 'src': '/icons/edit.png'}),
      el('span', 'deletesticky', {}, "&times;")
    )
    // newSticky.style.backgroundColor = randomColor();
    stickyArea.append(newSticky);
    positionSticky(newSticky, pos);
    applyDeleteListener();
    clearStickyForm();
  }
  function loadSticky(note_id: string, title: string, text: string, pos: Pos, size: Size = null) {

    const newSticky = el(
      'div',
      'drag sticky',
      {"id": note_id, "style.width": size ? `${size.width}px` : "", "style.height": size ? `${size.height}px` : ""},
      // children below
      el('h3', '', {}, textNode(stripHtml(title))),
      el('p', '', {}, ...splitBr(text)),
      el('input', 'editsticky', {'type': 'image', 'src': '/icons/edit.png'}),
      el('span', 'deletesticky', {}, "&times;")
    )
    stickyArea.append(newSticky);
    positionSticky(newSticky, pos);
    applyDeleteListener();
    clearStickyForm();
  }
  function clearStickyForm() {
    stickyTitleInput.value = "";
    stickyTextInput.value = "";
  }
  function positionSticky(sticky, pos) {
    const { left, top } = normalize({ x: pos.left, y: pos.top });
    sticky.style.left = `${left}px`;
    sticky.style.top = `${top}px`;
  }

  function stripHtml(text) {
    return text.replace(/<\/?[^>]+(>|$)/g, "");
  }
  function splitBr(text) {
    return stripHtml(text).split(/(\r|\n|\r\n)/g).map(t => {
      return /(\r|\n|\r\n)/g.test(t) ? el("br", "", {}) : t
    })
  }

  function applyDeleteListener() {
    let deleteStickyButtons = document.querySelectorAll(".deletesticky");
    deleteStickyButtons.forEach((dsb) => {
      dsb.removeEventListener("click", deleteSticky, false);
      dsb.addEventListener("click", deleteSticky);
    });
    let editStickyButtons = document.querySelectorAll(".editsticky");
    editStickyButtons.forEach((esb) => {
      esb.removeEventListener("click", editSticky, false);
      esb.addEventListener("click", editSticky);
    });
  }

  createStickyButton.addEventListener("click", sendCreateNote);
  applyDeleteListener();

  function loadLogs(logs) {
    logs.forEach(log => {
      if(log.includes('made a new')) {
        const [username, title] = log.split(' made a new sticky with title ')
        newStickyLog(username, title)
      } else if (log.includes('updated')) {
        const [username, title] = log.split(' updated sticky titled ')
        updateStickyLog(username, title)
      } else if (log.includes('removed')) {
        const [username, title] = log.split(' removed the sticky with title ')
        deleteStickyLog(username, title)
      }
    })
  }

  async function loadBoard() {
    const boardProtected = await isProtected(board_id)
    const check = new Promise((resolve, reject) => {
      if (boardProtected) {
        Swal.fire({
          title: "Sign In",
          text: "This board is password protected",
          html: `
            <input type="password" id="pass-input" class="swal2-input" placeholder="Password"/>
          `,
          confirmButtonColor: '#577399',
          confirmButtonText: `<span style="font-family: Space Mono">Sign In</span>`,
          preConfirm: () => {
            const passInput = Swal.getPopup().querySelector("#pass-input") as HTMLInputElement
            const password = passInput.value
            if (!password) {
              Swal.showValidationMessage("Please enter a password")
            }
            return password
          }
        }).then(result => {
          if (result.isConfirmed) {
            checkPassword(board_id, result.value).then(success => {
              if (success) {
                Swal.fire({
                  icon: 'success',
                  title: 'Success',
                  confirmButtonColor: '#577399',
                  confirmButtonText: `<span style="font-family: Space Mono">OK</span>`,
                })
                resolve(true)
              } else {
                Swal.fire({
                  icon: 'error',
                  title: 'Error Signing In',
                }).then(() => resolve(false))
              }
            })
          }
        })
      } else {
        resolve(true)
      }
    })
    check.then(success => {
      if (!success) {
        window.location.href = '/'
      }
      getBoard(board_id)
        .then((board) => {
          if (board) {
            board.notes.forEach((note) => {
              loadSticky(note._id.toString(), note.title, note.text, note.pos, note.size);
            });
            loadLogs(board.log)
            document.title = board.name
            document.querySelector('.board-title').setAttribute('value', board.name)
          } else {
            // window.location.href = "/undefined"
          }
        })
        .catch((e) => {
          console.log("e", e);
          // window.location.href = "/undefined"
        });
    })
  }
  loadBoard()

  function newStickyLog(username, title){
    const newLog = document.createElement('p')
    newLog.classList.add("log-entry")
    newLog.innerHTML = `<span class="log-keyword">` + username + `</span> made a new sticky with title `
    + `<span class="log-keyword">` + title + `</span>`
    const logArea = document.querySelector(".log-console")
    logArea.appendChild(newLog)
    logArea.scrollTop = logArea.scrollHeight
    logMessage(board_id, `${username} made a new sticky with title ${title}`)
  }

  function updateStickyLog(username, title){
    const newLog = document.createElement('p')
    newLog.classList.add("log-entry")
    newLog.innerHTML = `<span class="log-keyword">` + username + `</span> updated sticky titled `
    + `<span class="log-keyword">` + title + `</span>`
    const logArea = document.querySelector(".log-console")
    logArea.appendChild(newLog)
    logArea.scrollTop = logArea.scrollHeight
    logMessage(board_id, `${username} updated sticky titled ${title}`)
  }

  function deleteStickyLog(username, title){
    const newLog = document.createElement('p')
    newLog.classList.add("log-entry")
    newLog.innerHTML = `<span class="log-keyword">` + username + `</span> removed the sticky with title `
    + `<span class="log-keyword">` + title + `</span>`
    const logArea = document.querySelector(".log-console")
    logArea.appendChild(newLog)
    logArea.scrollTop = logArea.scrollHeight
    logMessage(board_id, `${username} removed the sticky with title ${title}`)
  }

  function clearBoard() {
    [...document.querySelectorAll('.sticky')].forEach(sticky => sticky.remove())
  }

  document.querySelector(".share-btn").addEventListener("click", (e) => {
    e.preventDefault()
    openPopup()
  });
  document.querySelector(".lock-btn").addEventListener("click", (e) => {
    e.preventDefault()
    protectPopup(board_id)
  })
  document.querySelector(".name-input").addEventListener("blur", (e) => {
    username = (e.target as HTMLInputElement).value
    setUsername(username)
  })
  document.querySelector(".board-title").addEventListener("blur", (e) => {
    document.title = (e.target as HTMLInputElement).value
    renameBoard(board_id, (e.target as HTMLInputElement).value)
  })
  document.querySelector(".info-btn").addEventListener("click", (e) => {
    e.preventDefault()
    infoPopup();
  })
});
